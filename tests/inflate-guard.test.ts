import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractText } from "@/lib/sources/extract";
import { extractDocxFigures } from "@/lib/sources/docx-figures";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A real, minimal docx whose document.xml holds `xmlMb` megabytes of paragraphs. */
async function docxOfSize(xmlMb: number): Promise<Buffer> {
  const para = "<w:p><w:r><w:t>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</w:t></w:r></w:p>";
  const body = para.repeat(Math.max(1, Math.floor((xmlMb * 1024 * 1024) / para.length)));
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

describe("a docx that inflates far beyond its size is refused before it is parsed", () => {
  // A 10 MB upload limit says nothing about what a zip holds. Measured on the
  // unguarded path: a 0.14 MB file took 23 s and 4 GB to read, a 0.34 MB one
  // 82 s and 6.5 GB, on the one process that also serves everybody else. The
  // cap on extracted text only applied after all of that had happened.
  it("refuses a 40 MB document.xml that weighs 0.1 MB, quickly", async () => {
    const bomb = await docxOfSize(40);
    expect(bomb.length).toBeLessThan(500_000);
    const t = performance.now();
    const r = await extractText("report.docx", DOCX_MIME, bomb);
    expect(performance.now() - t).toBeLessThan(2_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large|split/i);
  }, 30_000);

  it("refuses it on the figures path too", async () => {
    const bomb = await docxOfSize(40);
    const t = performance.now();
    await expect(extractDocxFigures(bomb)).rejects.toThrow(/too large|split/i);
    expect(performance.now() - t).toBeLessThan(2_000);
  }, 30_000);

  it("still reads an ordinary document, and one well past ordinary", async () => {
    for (const mb of [0.01, 3]) {
      const r = await extractText("report.docx", DOCX_MIME, await docxOfSize(mb));
      expect(r.ok, `${mb} MB of xml`).toBe(true);
      expect(r.text.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("reports it as a refused source rather than crashing the upload", async () => {
    const { db } = await import("@/db");
    const { courses } = await import("@/db/schema");
    const { ingestSource } = await import("@/lib/sources/ingest");
    const { newId } = await import("@/lib/util/id");
    const courseId = newId("course");
    db.insert(courses)
      .values({ id: courseId, title: "C", sourcePrompt: "b", lang: "en" })
      .run();

    const t = performance.now();
    const res = await ingestSource(courseId, {
      kind: "file",
      name: "bomb.docx",
      mime: null,
      buf: await docxOfSize(40),
    });
    expect(performance.now() - t).toBeLessThan(3_000);
    expect(res.ok).toBe(false);
  }, 30_000);

  it("a file that declares a small size and inflates large is still refused, fast", async () => {
    // The guard trusts the declared sizes, which is only safe because the zip
    // reader rejects an entry whose real size differs. Checked rather than
    // assumed: this edits the declared size of every entry down to 1000 bytes.
    const buf = await docxOfSize(40);
    let at = buf.readUInt32LE(buf.length - 22 + 16);
    const count = buf.readUInt16LE(buf.length - 22 + 10);
    for (let i = 0; i < count; i++) {
      const next = 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
      buf.writeUInt32LE(1000, at + 24);
      buf.writeUInt32LE(1000, buf.readUInt32LE(at + 42) + 22);
      at += next;
    }
    const t = performance.now();
    const r = await extractText("report.docx", DOCX_MIME, buf);
    expect(performance.now() - t).toBeLessThan(2_000);
    expect(r.ok).toBe(false);
  }, 30_000);

  it("does not choke on bytes that are not a zip at all", async () => {
    const r = await extractText("report.docx", DOCX_MIME, Buffer.from("not a zip"));
    expect(r.ok).toBe(false);
  });
});

/** A hand-built single-page PDF whose content stream holds `mb` MB of text operators. */
async function pdfOfSize(mb: number, opts: { image?: boolean } = {}): Promise<Buffer> {
  const { deflateSync } = await import("node:zlib");
  const unit = "BT /F1 12 Tf 72 700 Td (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) Tj ET\n";
  const z = deflateSync(Buffer.from(unit.repeat(Math.max(1, Math.floor((mb * 1048576) / unit.length)))), { level: 9 });
  const dict = `<< /Length ${z.length} /Filter /FlateDecode${opts.image ? " /Subtype /Image /Width 1 /Height 1" : ""} >>`;
  const objs: Array<string | null> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offs: number[] = [];
  let len = parts[0]!.length;
  objs.forEach((o, i) => {
    offs.push(len);
    const b =
      o === null
        ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${dict}\nstream\n`), z, Buffer.from("\nendstream\nendobj\n")])
        : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`);
    parts.push(b);
    len += b.length;
  });
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref)]);
}

describe("a pdf whose page content inflates far beyond its size is refused", () => {
  // Measured on the unguarded path: 0.12 MB of file took 7.8 s to read, and the
  // time is linear in what the streams hold.
  it("refuses 200 MB of page content that weighs well under 1 MB, quickly", async () => {
    const bomb = await pdfOfSize(200);
    expect(bomb.length).toBeLessThan(1_000_000);
    const t = performance.now();
    const r = await extractText("report.pdf", "application/pdf", bomb);
    expect(performance.now() - t).toBeLessThan(3_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large|split/i);
  }, 60_000);

  it("still reads an ordinary pdf", async () => {
    const r = await extractText("report.pdf", "application/pdf", await pdfOfSize(1));
    expect(r.error ?? "").toBe("");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("aaaa");
  }, 30_000);

  it("does not count a large image, which scans legitimately have", async () => {
    // Not read as text, so this only has to get past the guard.
    const { assertReasonablePdf } = await import("@/lib/sources/inflate-guard");
    const scan = await pdfOfSize(200, { image: true });
    expect(() => assertReasonablePdf(scan)).not.toThrow();
  }, 60_000);
});
