import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-exportpriv-")),
  "test.db",
);

const { db } = await import("@/db");
const { concepts, courses, modules, questions, restorations, sourceChunks } =
  await import("@/db/schema");
const { ingestSource } = await import("@/lib/sources/ingest");
const { protectAuthorText, saveRestorations, scanAuthorText } = await import(
  "@/lib/sources/protect"
);
const { getCourseBundle } = await import("@/lib/course/query");
const { assertNoProtectedValues, buildPackage } = await import(
  "@/lib/package/format"
);
const { packageFiles } = await import("@/lib/package/export");
const { newId } = await import("@/lib/util/id");

/**
 * The values an operator would recognise as their own if they saw them in a file
 * they handed to someone else. None of them may leave the machine in a package.
 */
const REAL_IP = "10.14.22.8";
const REAL_HOST = "checkout-db-01.internal.acme.corp";

const MATERIAL = `# Runbook checkout
Il servizio gira su ${REAL_IP} dietro il bilanciatore.
Il database di produzione è ${REAL_HOST}, porta 5432.
Il rollback si fa con la procedura descritta sotto.`;

/** Everything a package would carry, as one string, the way a recipient sees it. */
function serialisedPackage(courseId: string): string {
  const bundle = getCourseBundle(courseId)!;
  const pkg = buildPackage(bundle, { exportedAt: 0 });
  return [
    JSON.stringify(pkg),
    ...Object.values(packageFiles(pkg)),
  ].join("\n");
}

async function seedCourseFromMaterial(opts: {
  authorContext?: string | null;
  sourcePrompt?: string;
}): Promise<string> {
  const courseId = newId("course");
  // Same order the create route uses: protect the brief before the row exists,
  // then save the restore map against it.
  const brief = await scanAuthorText(opts.sourcePrompt ?? "runbook di rilascio");
  db.insert(courses)
    .values({
      id: courseId,
      title: brief.text.slice(0, 80),
      sourcePrompt: brief.text,
      lang: "it",
      status: "ready",
    })
    .run();
  saveRestorations(courseId, brief.restorations);

  if (opts.authorContext) {
    db.update(courses)
      .set({
        authorContextMd: await protectAuthorText(courseId, opts.authorContext),
      })
      .where(eq(courses.id, courseId))
      .run();
  }

  await ingestSource(courseId, {
    kind: "text",
    name: "runbook.md",
    text: MATERIAL,
  });

  // What the model writes is written FROM the stored chunks, so the worst
  // realistic case is a module that quotes the stored text verbatim.
  const chunk = db
    .select()
    .from(sourceChunks)
    .all()
    .map((c) => c.text)
    .join("\n");

  const conceptId = newId("concept");
  db.insert(concepts)
    .values({
      id: conceptId,
      courseId,
      title: "Dove gira il servizio",
      summary: chunk.slice(0, 200),
      depthLevel: 1,
    })
    .run();
  db.insert(modules)
    .values({
      id: newId("module"),
      conceptId,
      kind: "concept",
      bodyMd: `# Dove gira\n${chunk}`,
      status: "ready",
    })
    .run();
  db.insert(questions)
    .values({
      id: newId("q"),
      conceptId,
      prompt: `Su quale host gira il database?`,
      expectedAnswer: chunk.slice(0, 120),
      bloomLevel: "remember",
      format: "open",
    })
    .run();

  return courseId;
}

beforeEach(() => {
  for (const t of [questions, modules, concepts, restorations, courses]) {
    db.delete(t).run();
  }
});

describe("what leaves the machine in a package", () => {
  it("carries no infrastructure value that came from the material", async () => {
    const courseId = await seedCourseFromMaterial({});

    // Precondition: the scan really did catch them, otherwise this test would
    // pass by finding nothing rather than by protecting anything.
    const kept = db.select().from(restorations).all();
    expect(kept.map((r) => r.value).sort()).toEqual(
      [REAL_HOST, REAL_IP].sort(),
    );

    const out = serialisedPackage(courseId);
    for (const secret of [REAL_IP, REAL_HOST]) {
      expect(out).not.toContain(secret);
    }
    // The placeholders travel instead, so the course still reads correctly for
    // anyone who imports it into an instance that holds the restore map. They are
    // HMAC tokens (16 hex), not a plain hash, so the real values cannot be
    // recovered from the package by brute force.
    expect(out).toMatch(/⟨cxt:[0-9a-f]{16}⟩/);
  });

  it("carries no restore map: the recipient gets placeholders and nothing to resolve them with", async () => {
    const courseId = await seedCourseFromMaterial({});
    const bundle = getCourseBundle(courseId)!;
    expect(bundle.restorations.length).toBe(2); // the app has them…
    const pkg = buildPackage(bundle, { exportedAt: 0 });
    expect(Object.keys(pkg)).not.toContain("restorations"); // …the package does not
  });

  it("carries no infrastructure value the author typed into the interview", async () => {
    // The author answers "where does it run?" with the real host. That text
    // never passed through a file upload, so nothing had scanned it before.
    const courseId = await seedCourseFromMaterial({
      authorContext: `**Dove gira?**\nSu ${REAL_IP}, il db è ${REAL_HOST}.`,
    });
    const out = serialisedPackage(courseId);
    for (const secret of [REAL_IP, REAL_HOST]) {
      expect(out).not.toContain(secret);
    }
  });

  it("carries no infrastructure value the author typed into the brief", async () => {
    const courseId = await seedCourseFromMaterial({
      sourcePrompt: `come si rilascia su ${REAL_HOST}`,
      authorContext: null,
    });
    const out = serialisedPackage(courseId);
    expect(out).not.toContain(REAL_HOST);
  });
});

describe("the export refuses rather than leaks", () => {
  it("throws before producing anything if a protected value reached the package", async () => {
    const courseId = await seedCourseFromMaterial({});
    const bundle = getCourseBundle(courseId)!;
    // The upstream regression this guard exists for: a module that somehow
    // holds the real value instead of the placeholder.
    bundle.modules[0]!.module!.bodyMd = `Il db è ${REAL_HOST}.`;
    expect(() => buildPackage(bundle, { exportedAt: 0 })).toThrow(
      /Export refused/,
    );
  });

  it("guards both export routes, because the check is inside buildPackage", () => {
    // Not a style point: the download route builds its own package and never
    // calls writePackage, so a guard placed beside one caller misses the path
    // people actually use.
    const routes = [
      "src/app/api/courses/[id]/package/route.ts",
      "src/lib/package/export.ts",
    ];
    for (const r of routes) {
      const src = readFileSync(join(process.cwd(), r), "utf8");
      expect(src).toContain("buildPackage");
    }
    const format = readFileSync(
      join(process.cwd(), "src/lib/package/format.ts"),
      "utf8",
    );
    expect(format).toMatch(/assertNoProtectedValues\(pkg, bundle\.restorations\)/);
  });

  it("lets a clean package through", async () => {
    const courseId = await seedCourseFromMaterial({});
    const bundle = getCourseBundle(courseId)!;
    const pkg = buildPackage(bundle, { exportedAt: 0 });
    expect(() => assertNoProtectedValues(pkg, bundle.restorations)).not.toThrow();
  });
});

/** Every file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("the gate cannot be skipped by a new route", () => {
  // The tests above prove today's two paths are clean. This one is what stops a
  // third from being added without the scan: writing author text into the course
  // row is the whole leak, so the write and the gate must appear together.
  it("scans author text wherever a route writes it to the course row", () => {
    const files = walk(join(process.cwd(), "src/app"));
    expect(files.length).toBeGreaterThan(30);

    const touching = files.filter((f) =>
      /\b(authorContextMd|sourcePrompt)\b/.test(readFileSync(f, "utf8")),
    );
    // Guard the guard: if a rename made this match nothing, it would pass by
    // checking nothing at all.
    expect(touching.length).toBeGreaterThan(0);

    const offenders = touching
      .filter((f) => !readFileSync(f, "utf8").includes("@/lib/sources/protect"))
      .map((f) => f.replace(`${process.cwd()}/`, ""));
    expect(offenders).toEqual([]);
  });
});
