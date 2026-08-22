import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/db";
import {
  courses as coursesT,
  figures as figuresT,
  sources as sourcesT,
} from "@/db/schema";
import {
  decideFigure,
  figureBytes,
  figureHash,
  figureToken,
  insertFigures,
  listFigures,
  measure,
  renderFigureTokens,
  selectFigures,
  slotTokens,
  worthKeeping,
  MIN_EDGE_PX,
} from "@/lib/sources/figures";
import { fillSlots, htmlToText } from "@/lib/sources/docx-figures";
import { renderMarkdown } from "@/lib/md";
import { newId } from "@/lib/util/id";
import { eq } from "drizzle-orm";

/**
 * Figures are the one thing that walks past the DLP gate, which scans strings:
 * a screenshot of a terminal holding a key is not a string. The gate here is a
 * person, so these tests are mostly about the two ways a person's decision gets
 * bypassed: a picture that shows without being approved, and a picture that
 * reaches somebody who was never given the course.
 */

/** A real 200x200 PNG, small enough to keep in the test and big enough to pass. */
async function png(size = 200, colour = 0): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: colour, g: 100, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

function clean(): void {
  db.delete(figuresT).run();
  db.delete(sourcesT).run();
  db.delete(coursesT).run();
}

function course(): { courseId: string; sourceId: string } {
  const courseId = newId("course");
  db.insert(coursesT)
    .values({ id: courseId, title: "C", sourcePrompt: "b", lang: "en" })
    .run();
  const sourceId = newId("src");
  db.insert(sourcesT)
    .values({ id: sourceId, courseId, kind: "file", name: "doc.docx" })
    .run();
  return { courseId, sourceId };
}

/**
 * Built here rather than committed as a binary, so what is being tested is
 * visible: a document with a heading, a paragraph, a picture between two
 * paragraphs, and a second picture that is too small to be worth anybody's
 * attention.
 */
async function buildDocx(images: { name: string; buf: Buffer }[]): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const rels = images
    .map(
      (im, i) =>
        `<Relationship Id="rIdImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`,
    )
    .join("");
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  const drawing = (i: number): string =>
    `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${i + 1}" name="Picture ${i}" descr="diagram ${i}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImg${i}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>The edge gateway</w:t></w:r></w:p><w:p><w:r><w:t>Before the picture.</w:t></w:r></w:p>${images.map((_, i) => drawing(i)).join("")}<w:p><w:r><w:t>After the picture.</w:t></w:r></w:p></w:body></w:document>`,
  );
  for (const im of images) zip.file(`word/media/${im.name}`, im.buf);
  return zip.generateAsync({ type: "nodebuffer" });
}

beforeEach(clean);

describe("deciding what is a figure and what is furniture", () => {
  it("reads the format from the bytes, not from what the document claimed", async () => {
    // The mime in a docx is a string somebody wrote. These are untrusted files.
    const m = await measure(await png());
    expect(m).toEqual({ width: 200, height: 200, mime: "image/png" });
  });

  it("refuses anything that is not an image it can measure", async () => {
    expect(await measure(Buffer.from("PK not an image"))).toBeNull();
    expect(await measure(Buffer.alloc(0))).toBeNull();
  });

  it("drops the small stuff, which is bullets and logos and signatures", () => {
    const big = { width: 400, height: 300, mime: "image/png" };
    const icon = { width: MIN_EDGE_PX - 1, height: 400, mime: "image/png" };
    expect(worthKeeping(big, 1000)).toBe(true);
    expect(worthKeeping(icon, 1000)).toBe(false);
    // Every one of these is another decision asked of the author for nothing.
    expect(worthKeeping(big, 50 * 1024 * 1024)).toBe(false);
  });

  it("keeps one copy of the logo that is in every document", async () => {
    const { courseId, sourceId } = course();
    const same = await png();
    const kept = await selectFigures(courseId, sourceId, [
      { buf: same, mime: "image/png", altText: null },
      { buf: same, mime: "image/png", altText: "again" },
      { buf: await png(200, 40), mime: "image/png", altText: null },
    ]);
    expect(kept).toHaveLength(2);
    expect(kept[0]!.slot).toBe(0);
    expect(kept[1]!.slot).toBe(2);
  });

  it("does not ask twice across two documents either", async () => {
    const { courseId, sourceId } = course();
    const logo = await png();
    const first = await selectFigures(courseId, sourceId, [
      { buf: logo, mime: "image/png", altText: null },
    ]);
    db.transaction((tx) => insertFigures(tx, courseId, sourceId, first));
    const second = await selectFigures(courseId, sourceId, [
      { buf: logo, mime: "image/png", altText: null },
    ]);
    expect(second).toEqual([]);
  });
});

describe("the marker left in the text", () => {
  it("puts a token where a kept picture was and nothing where a dropped one was", () => {
    const tokens = slotTokens(
      [{ slot: 1, token: "⟨fig:abc123abc123⟩" } as never],
      3,
    );
    expect(tokens).toEqual([null, "⟨fig:abc123abc123⟩", null]);
    expect(fillSlots("a [[FIG0]] b [[FIG1]] c [[FIG2]] d", tokens)).toBe(
      "a  b ⟨fig:abc123abc123⟩ c  d",
    );
  });

  it("keeps the picture where it sat, not at the end", () => {
    // A diagram three paragraphs above the paragraph explaining it is a
    // different document from one with the diagrams collected at the back.
    const text = htmlToText(
      '<h1>Edge</h1><p>Before.</p><img src="[[FIG0]]"><p>After.</p>',
    );
    expect(text.indexOf("Before")).toBeLessThan(text.indexOf("[[FIG0]]"));
    expect(text.indexOf("[[FIG0]]")).toBeLessThan(text.indexOf("After"));
  });

  it("drops an image the extractor refused, rather than leaving a dangling marker", () => {
    // A marker pointing at nothing would be copied into a module by the writer.
    expect(htmlToText('<p>a</p><img src="cid:whatever"><p>b</p>')).toBe("a\n\nb");
  });
});

describe("who may see a figure", () => {
  it("renders only the approved ones, and removes the rest silently", async () => {
    const { courseId, sourceId } = course();
    const kept = await selectFigures(courseId, sourceId, [
      { buf: await png(), mime: "image/png", altText: "the edge gateway" },
      { buf: await png(220, 90), mime: "image/png", altText: null },
    ]);
    db.transaction((tx) => insertFigures(tx, courseId, sourceId, kept));
    const body = `Look: ${kept[0]!.token} and ${kept[1]!.token}.`;

    // Nothing is approved yet, so nothing shows.
    expect(renderFigureTokens(courseId, body)).toBe("Look:  and .");

    decideFigure(courseId, kept[0]!.id, "approved", "user_1");
    const out = renderFigureTokens(courseId, body);
    expect(out).toContain(`/api/courses/${courseId}/figures/${kept[0]!.id}`);
    expect(out).toContain("the edge gateway");
    expect(out).not.toContain(kept[1]!.id);
  });

  it("a token for a figure that no longer exists leaves no broken image", () => {
    const { courseId } = course();
    expect(renderFigureTokens(courseId, `x ${figureToken("f".repeat(64))} y`)).toBe(
      "x  y",
    );
  });

  it("records who decided and when", async () => {
    const { courseId, sourceId } = course();
    const kept = await selectFigures(courseId, sourceId, [
      { buf: await png(), mime: "image/png", altText: null },
    ]);
    db.transaction((tx) => insertFigures(tx, courseId, sourceId, kept));
    expect(decideFigure(courseId, kept[0]!.id, "rejected", "user_7")).toBe(true);
    const row = listFigures(courseId)[0]!;
    expect(row.status).toBe("rejected");
    expect(row.decidedBy).toBe("user_7");
    expect(row.decidedAt).toBeGreaterThan(0);
  });

  it("will not fetch a figure through another course's id", async () => {
    // The id is guessable; the pairing is what is checked.
    const a = course();
    const b = course();
    const kept = await selectFigures(a.courseId, a.sourceId, [
      { buf: await png(), mime: "image/png", altText: null },
    ]);
    db.transaction((tx) => insertFigures(tx, a.courseId, a.sourceId, kept));
    expect(figureBytes(a.courseId, kept[0]!.id)).not.toBeNull();
    expect(figureBytes(b.courseId, kept[0]!.id)).toBeNull();
    expect(decideFigure(b.courseId, kept[0]!.id, "approved", "u")).toBe(false);
  });
});

describe("what an image is allowed to point at", () => {
  it("keeps an image served by this install", () => {
    const html = renderMarkdown("![a](/api/courses/course_1/figures/fig_2)");
    expect(html).toContain("<img");
    expect(html).toContain("/api/courses/course_1/figures/fig_2");
    expect(html).toContain('loading="lazy"');
  });

  it("removes one pointing anywhere else, which is how a course becomes a beacon", () => {
    // A course is a file people pass around. An image on somebody else's host
    // calls that host every time a module is opened, reporting the reader's
    // address and the moment they read it.
    for (const src of [
      "https://tracker.example/pixel.png",
      "//tracker.example/pixel.png",
      "data:image/png;base64,iVBORw0KGgo=",
      "/api/courses/course_1/figures/fig_2?to=tracker.example",
      "/etc/passwd",
      "/api/courses/../../secrets",
    ]) {
      const html = renderMarkdown(`![a](${src})`);
      expect(html, src).not.toContain("<img");
      expect(html, src).not.toContain("tracker.example");
    }
  });

  it("still refuses a raw img tag written into the body by hand", () => {
    const html = renderMarkdown('<img src="https://tracker.example/p.png">');
    expect(html).not.toContain("tracker.example");
  });
});

describe("the hash the token is built from", () => {
  it("is the same for the same bytes and different for different ones", async () => {
    const a = await png();
    expect(figureHash(a)).toBe(figureHash(Buffer.from(a)));
    expect(figureHash(a)).not.toBe(figureHash(await png(200, 40)));
    expect(figureToken(figureHash(a))).toMatch(/^⟨fig:[0-9a-f]{12}⟩$/);
  });
});

describe("a real .docx, end to end", () => {

  it("finds the pictures, keeps the text, and marks where each one was", async () => {
    const { extractDocxFigures } = await import("@/lib/sources/docx-figures");
    const buf = await buildDocx([
      { name: "image1.png", buf: await png(300) },
      { name: "image2.png", buf: await png(40) },
    ]);
    const out = await extractDocxFigures(buf);

    expect(out.figures).toHaveLength(2);
    expect(out.text).toContain("The edge gateway");
    expect(out.text).toContain("Before the picture.");
    expect(out.text.indexOf("Before the picture.")).toBeLessThan(
      out.text.indexOf("[[FIG0]]"),
    );
    expect(out.text.indexOf("[[FIG0]]")).toBeLessThan(
      out.text.indexOf("After the picture."),
    );
    // Builds real PNGs with sharp and zips them into a document. That is
    // seconds of actual work, and the 5s default left no room on a machine
    // slower than the one it was written on: both of these timed out on
    // Windows, which reads as a broken feature rather than a tight clock.
  }, 60_000);

  it("keeps the big one, drops the icon, and leaves no marker for the icon", async () => {
    const { extractDocxFigures } = await import("@/lib/sources/docx-figures");
    const { courseId, sourceId } = course();
    const out = await extractDocxFigures(
      await buildDocx([
        { name: "image1.png", buf: await png(300) },
        { name: "image2.png", buf: await png(40) },
      ]),
    );
    const kept = await selectFigures(courseId, sourceId, out.figures);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.width).toBe(300);

    const text = fillSlots(out.text, slotTokens(kept, out.figures.length));
    expect(text).toContain(kept[0]!.token);
    expect(text).not.toContain("[[FIG");
    // Builds real PNGs with sharp and zips them into a document. That is
    // seconds of actual work, and the 5s default left no room on a machine
    // slower than the one it was written on: both of these timed out on
    // Windows, which reads as a broken feature rather than a tight clock.
  }, 60_000);

  it("survives a document whose pictures are not images at all", async () => {
    const { extractDocxFigures } = await import("@/lib/sources/docx-figures");
    const { courseId, sourceId } = course();
    const out = await extractDocxFigures(
      await buildDocx([{ name: "image1.png", buf: Buffer.from("not a png") }]),
    );
    expect(await selectFigures(courseId, sourceId, out.figures)).toEqual([]);
    // And the text is still the document's text, with no marker left behind.
    const text = fillSlots(out.text, slotTokens([], out.figures.length));
    expect(text).toContain("The edge gateway");
    expect(text).not.toContain("[[FIG");
  });
});

describe("ingesting a document that has pictures in it", () => {
  it("stores them pending, and puts the token in the chunked text", async () => {
    const { ingestSource } = await import("@/lib/sources/ingest");
    const { sourceChunks } = await import("@/db/schema");

    const courseId = newId("course");
    db.insert(coursesT)
      .values({ id: courseId, title: "C", sourcePrompt: "b", lang: "en" })
      .run();

    const buf = await buildDocx([{ name: "image1.png", buf: await png(300) }]);
    const res = await ingestSource(courseId, {
      kind: "file",
      name: "runbook.docx",
      mime: null,
      buf,
    });

    expect(res.ok).toBe(true);
    const figs = listFigures(courseId);
    expect(figs).toHaveLength(1);
    // Pending, always. A picture is in the course when somebody says so.
    expect(figs[0]!.status).toBe("pending");

    const chunks = db
      .select({ text: sourceChunks.text })
      .from(sourceChunks)
      .where(eq(sourceChunks.courseId, courseId))
      .all();
    const all = chunks.map((c) => c.text).join("\n");
    expect(all).toContain("The edge gateway");
    expect(all).toMatch(/⟨fig:[0-9a-f]{12}⟩/);
    // Same reason as the two above: real PNGs, zipped into a document, and
    // the 5s default is not a budget for that on a machine four times slower
    // than the one the number was picked on.
  }, 60_000);
});

describe("a course with pictures, exported and imported somewhere else", () => {
  /** Every field the package format reads, so a failure here is about figures. */
  const bundleFor = (courseId: string) => ({
    course: {
      id: courseId,
      title: "Acme on-call",
      sourcePrompt: "brief",
      authorContextMd: "context",
      lang: "en",
      objective: "objective",
      domain: "platform",
      concretenessRule: "rule",
      startLevel: "base",
      scheduleMd: null,
      glossaryMd: null,
      budgetMinutes: null,
      assessmentMode: "practice",
      status: "ready",
    } as never,
    modules: [],
    edges: [],
    cuts: [],
    sources: [],
    restorations: [],
  });

  it("carries the approved ones, and they arrive waiting for a decision", async () => {
    const { buildPackage } = await import("@/lib/package/format");
    const { importPackage } = await import("@/lib/package/import");
    const { exportableFigures } = await import("@/lib/sources/figures");

    const { courseId, sourceId } = course();
    const kept = await selectFigures(courseId, sourceId, [
      { buf: await png(240), mime: "image/png", altText: "the edge" },
      { buf: await png(260, 80), mime: "image/png", altText: null },
    ]);
    db.transaction((tx) => insertFigures(tx, courseId, sourceId, kept));
    decideFigure(courseId, kept[0]!.id, "approved", "u1");
    decideFigure(courseId, kept[1]!.id, "rejected", "u1");

    // Only the approved one leaves. The other was looked at and refused, and a
    // refusal that travels as an attachment is not a refusal.
    const packed = exportableFigures(courseId);
    expect(packed).toHaveLength(1);
    expect(packed[0]!.sha256).toBe(kept[0]!.sha256);

    const pkg = buildPackage(
      bundleFor(courseId),
      { exportedAt: 1000, figures: packed },
    );
    expect(pkg.figures).toHaveLength(1);

    // The owner is required by design: a course with none is visible to
    // everyone on the install.
    const importedId = importPackage(pkg, "user_importer");
    const there = listFigures(importedId);
    expect(there).toHaveLength(1);
    // The person who approved this works somewhere else.
    expect(there[0]!.status).toBe("pending");
    expect(there[0]!.altText).toBe("the edge");
    expect(there[0]!.width).toBe(240);
  });

  it("stops at a whole picture when the budget runs out, never mid-image", async () => {
    const { buildPackage, FIGURE_BUDGET_BYTES } = await import(
      "@/lib/package/format"
    );
    const big = Buffer.alloc(Math.ceil((FIGURE_BUDGET_BYTES * 3) / 4) - 1000, 7);
    const pkg = buildPackage(
      bundleFor("course_x"),
      {
        exportedAt: 1,
        figures: [
          { sha256: "a".repeat(64), mime: "image/png", width: 9, height: 9, altText: null, data: big },
          { sha256: "b".repeat(64), mime: "image/png", width: 9, height: 9, altText: null, data: big },
        ],
      },
    );
    // One whole picture, not two halves: a truncated image is bytes that decode
    // to nothing, which is worse than a course that says it has fewer pictures.
    expect(pkg.figures).toHaveLength(1);
    expect(Buffer.from(pkg.figures![0]!.dataBase64, "base64").length).toBe(
      big.length,
    );
  });

  it("still reads a package written before pictures existed", async () => {
    const { ferrataPackageSchema, buildPackage } = await import(
      "@/lib/package/format"
    );
    const pkg = buildPackage(
      bundleFor("course_x"),
      { exportedAt: 1 },
    );
    const { figures: _dropped, ...old } = pkg;
    expect(ferrataPackageSchema.safeParse(old).success).toBe(true);
  });
});

describe("the Obsidian vault", () => {
  const fig = (sha: string) => ({
    sha256: sha.repeat(64).slice(0, 64),
    mime: "image/png",
    data: Buffer.from("bytes"),
  });

  it("turns a token into an embed Obsidian actually renders", async () => {
    const { embedFigures, assetName } = await import("@/lib/export/obsidian");
    const f = fig("a");
    const out = embedFigures(`Look at ⟨fig:${f.sha256.slice(0, 12)}⟩ here.`, [f]);
    expect(out.body).toBe(`Look at ![[${assetName(f)}]] here.`);
    expect([...out.used]).toEqual([f.sha256]);
  });

  it("removes a token whose picture is not in the export", async () => {
    // Never approved, or left out for size. A vault carrying the raw token
    // would be showing the reader the plumbing.
    const { embedFigures } = await import("@/lib/export/obsidian");
    const out = embedFigures("before ⟨fig:0123456789ab⟩ after", []);
    expect(out.body).toBe("before  after");
    expect(out.used.size).toBe(0);
  });

  it("writes only the pictures a note embeds", async () => {
    const { buildVault } = await import("@/lib/export/obsidian");
    const used = fig("a");
    const unused = fig("b");
    const vault = buildVault(
      {
        course: { id: "c", title: "Course", lang: "en" } as never,
        modules: [
          {
            concept: {
              id: "k1",
              title: "Edge gateway",
              summary: "s",
              priority: "high",
              depthLevel: 1,
              estimatedMinutes: 20,
            } as never,
            module: {
              kind: "concept",
              bodyMd: `Body with ⟨fig:${used.sha256.slice(0, 12)}⟩.`,
            } as never,
            questions: [],
          },
        ],
        edges: [],
        cuts: [],
        sources: [],
        restorations: [],
      },
      [used, unused],
    );
    // An image no page shows is an image somebody exported by accident.
    expect(vault.assets.map((a) => a.name)).toEqual([
      `assets/fig-${used.sha256.slice(0, 12)}.png`,
    ]);
    // By file name, not by content: the index note lists every module title,
    // so searching the text finds it first and it has no body to embed in.
    const note = vault.files.find((f) => f.name === "00 Edge gateway.md")!;
    expect(note.content).toContain("![[assets/fig-");
    expect(note.content).not.toContain("⟨fig:");
  });
});

describe("the writing stages are told about figure tokens", () => {
  /**
   * A figure reaches a module only if the model copies its token through from
   * the material, and until this was checked nothing had ever asked it to. The
   * token was placed into the source text, the prompt described the protected
   * value placeholder beside it in detail, and said nothing at all about the
   * one standing for a picture. So a diagram survived into a course by luck,
   * and the two stages that rewrite a body could each drop it silently.
   *
   * Checked on the prompt file because that is where the instruction lives and
   * where it would be lost again: a prompt is edited far more often than the
   * code around it, and nothing else would notice.
   */
  const prompt = readFileSync(
    resolve(__dirname, "..", "src", "lib", "llm", "tasks", "write_module", "prompt.md"),
    "utf8",
  );

  it("shows the token's actual shape, not a description of it", () => {
    expect(prompt).toMatch(/⟨fig:[0-9a-f]+⟩/);
  });

  it("says to copy it rather than to describe the picture", () => {
    expect(prompt.toLowerCase()).toContain("verbatim");
  });

  it("still explains the protected value placeholder, which came first", () => {
    expect(prompt).toMatch(/⟨cxt:[0-9a-f]+⟩/);
  });
});
