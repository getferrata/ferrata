import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  llmCalls as llmCallsT,
  modules as modulesT,
  questions as questionsT,
  figures as figuresT,
  sourceChunks as chunksT,
  sources as sourcesT,
  type ModuleKind,
} from "@/db/schema";
import { INVARIANTS, checkInvariants, formatViolations } from "@/lib/audit/invariants";
import { newId, now } from "@/lib/util/id";

/**
 * Tests for the checks.
 *
 * An invariant is code, and it fails in two directions that look identical from
 * outside: a typo in a table name throws, and wrong logic returns nothing for
 * ever. The second is the dangerous one, because a check that can never fire
 * reads exactly like a check that keeps passing. The first draft of this set
 * contained one, an EXISTS and a NOT EXISTS over the same condition, and it
 * would have sat there being reassuring indefinitely. So each check has to be
 * shown catching the thing it claims to catch.
 */

function clean(): void {
  db.delete(figuresT).run();
  db.delete(chunksT).run();
  db.delete(sourcesT).run();
  db.delete(questionsT).run();
  db.delete(modulesT).run();
  db.delete(conceptsT).run();
  db.delete(llmCallsT).run();
  db.delete(coursesT).run();
}

function readyCourseWithConcept(): { courseId: string; conceptId: string } {
  const courseId = newId("course");
  db.insert(coursesT)
    .values({
      id: courseId,
      title: "Course",
      sourcePrompt: "brief",
      lang: "en",
      status: "ready",
    })
    .run();
  const conceptId = newId("concept");
  db.insert(conceptsT)
    .values({ id: conceptId, courseId, title: "C", summary: "s", topoOrder: 0 })
    .run();
  return { courseId, conceptId };
}

function addModule(conceptId: string, kind: ModuleKind = "concept"): string {
  const id = newId("module");
  db.insert(modulesT)
    .values({ id, conceptId, kind, bodyMd: "body", status: "ready", generatedAt: now() })
    .run();
  return id;
}

function addQuestion(conceptId: string, retired = false): void {
  db.insert(questionsT)
    .values({
      id: newId("q"),
      conceptId,
      prompt: "p",
      expectedAnswer: "a",
      bloomLevel: "remember",
      format: "open",
      misconceptionsJson: "[]",
      retiredAt: retired ? now() : null,
    })
    .run();
}

const broken = (name: string): boolean =>
  checkInvariants().some((v) => v.invariant === name);

beforeEach(clean);

describe("the checks themselves", () => {
  it("every one is valid SQL against the real schema", () => {
    // A misspelled column throws rather than returning nothing, so this is the
    // difference between a check that is wrong and a check that is absent.
    for (const inv of INVARIANTS) {
      expect(() => db.all(sql.raw(inv.sql)), inv.name).not.toThrow();
    }
  });

  it("says nothing about an empty database", () => {
    expect(checkInvariants()).toEqual([]);
    expect(formatViolations([])).toContain("hold");
  });

  it("has a distinct name for each, since the name is how a violation is read", () => {
    const names = INVARIANTS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("explains what each one costs a person, not just that it failed", () => {
    for (const inv of INVARIANTS) {
      expect(inv.matters.length, inv.name).toBeGreaterThan(40);
    }
  });
});

/** A source and a figure on it, with whatever the caller wants to bend. */
function addFigure(
  courseId: string,
  over: Partial<{
    sourceCourseId: string;
    status: "pending" | "approved" | "rejected";
    decidedBy: string | null;
    decidedAt: number | null;
    bytes: number;
    data: Buffer;
    sha256: string;
  }> = {},
): string {
  const sourceId = newId("src");
  db.insert(sourcesT)
    .values({
      id: sourceId,
      courseId: over.sourceCourseId ?? courseId,
      kind: "file",
      name: "doc.docx",
    })
    .run();
  const id = newId("fig");
  db.insert(figuresT)
    .values({
      id,
      courseId,
      sourceId,
      sha256: over.sha256 ?? "a".repeat(64),
      mime: "image/png",
      bytes: over.bytes ?? 10,
      width: 200,
      height: 200,
      ord: 0,
      status: over.status ?? "pending",
      decidedBy: over.decidedBy ?? null,
      decidedAt: over.decidedAt ?? null,
      data: over.data ?? Buffer.from("0123456789"),
    })
    .run();
  return id;
}

describe("the checks about pictures", () => {
  it("finds a figure whose source belongs to another course", () => {
    // The leak the approval step exists to prevent: a picture out of one
    // company's documents, served under another company's course.
    const mine = readyCourseWithConcept();
    const other = readyCourseWithConcept();
    addFigure(mine.courseId, { sourceCourseId: other.courseId });
    expect(broken("a figure belongs to a source of its own course")).toBe(true);
  });

  it("accepts one whose source is its own", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId);
    expect(broken("a figure belongs to a source of its own course")).toBe(false);
  });

  it("finds a decision with nobody's name on it", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { status: "approved", decidedBy: null, decidedAt: null });
    expect(broken("a decided figure records who decided it")).toBe(true);
  });

  it("finds a decision with a name and no date, which is half a record", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { status: "rejected", decidedBy: "user_1", decidedAt: null });
    expect(broken("a decided figure records who decided it")).toBe(true);
  });

  it("accepts a decision that says who and when", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { status: "approved", decidedBy: "user_1", decidedAt: now() });
    expect(broken("a decided figure records who decided it")).toBe(false);
  });

  it("finds a pending figure that somebody already decided", () => {
    // What a mistaken bulk update looks like from the other side.
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { status: "pending", decidedBy: "user_1" });
    expect(broken("a figure that is still pending has not been decided")).toBe(true);
  });

  it("finds a picture with no bytes behind it", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { bytes: 0, data: Buffer.alloc(0) });
    expect(broken("no figure is stored without bytes")).toBe(true);
  });

  it("finds a hash no token could ever point at", () => {
    // The token in a module body is the first twelve characters of this hash.
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { sha256: "not-a-hash" });
    expect(broken("a figure's hash is the one its token is built from")).toBe(true);
  });

  it("accepts a real hash", () => {
    const { courseId } = readyCourseWithConcept();
    addFigure(courseId, { sha256: "f3a9".repeat(16) });
    expect(broken("a figure's hash is the one its token is built from")).toBe(false);
  });
});

describe("each check catches what it claims to", () => {
  it("finds a finished module with no live test", () => {
    const { conceptId } = readyCourseWithConcept();
    addModule(conceptId);
    expect(broken("a module in a finished course always has a live test")).toBe(true);

    addQuestion(conceptId);
    expect(broken("a module in a finished course always has a live test")).toBe(false);
  });

  it("ignores a build still in flight, which is the whole reason it is scoped", () => {
    // 179 of the 184 rows the first version of this check reported were courses
    // in the middle of generating, where a written body waiting on its
    // questions is correct and expected.
    const { courseId, conceptId } = readyCourseWithConcept();
    db.update(coursesT)
      .set({ status: "generating" })
      .where(sql`${coursesT.id} = ${courseId}`)
      .run();
    addModule(conceptId);
    expect(broken("a module in a finished course always has a live test")).toBe(false);
  });

  it("does not ask a method module for a test", () => {
    // The hand-written reference course ends with two of these and carries no
    // test for either, so the earlier version of this check was contradicted by
    // the output it is measured against. A rule the reference breaks is wrong.
    const { conceptId } = readyCourseWithConcept();
    addModule(conceptId, "method");
    expect(broken("a module in a finished course always has a live test")).toBe(false);
  });

  it("counts a retired question as no test at all", () => {
    const { conceptId } = readyCourseWithConcept();
    addModule(conceptId);
    addQuestion(conceptId, true);
    expect(broken("a module in a finished course always has a live test")).toBe(true);
  });

  it("finds a concept in a finished course with no module", () => {
    readyCourseWithConcept();
    expect(broken("a ready course has a module for every concept it kept")).toBe(true);
  });

  it("finds an empty source chunk", () => {
    const { courseId } = readyCourseWithConcept();
    const sourceId = newId("src");
    db.insert(sourcesT)
      .values({ id: sourceId, courseId, kind: "text", name: "n", status: "ok" })
      .run();
    db.insert(chunksT)
      .values({ id: newId("chunk"), sourceId, courseId, ord: 0, text: "   " })
      .run();
    expect(broken("no source chunk is empty")).toBe(true);
  });

  it("finds credits that disagree with the dollars beside them", () => {
    db.insert(llmCallsT)
      .values({
        id: newId("llm"),
        task: "write_module",
        provider: "anthropic",
        model: "claude-sonnet-5",
        costUsd: 9,
        credits: 1,
      })
      .run();
    expect(broken("the credits charged match the cost recorded")).toBe(true);
  });

  it("accepts credits that are the rounded-up cents of the cost", () => {
    for (const [usd, credits] of [
      [0.0033, 1],
      [0.5, 50],
      [1, 100],
      [0.0001, 1],
    ] as const) {
      clean();
      db.insert(llmCallsT)
        .values({
          id: newId("llm"),
          task: "write_module",
          provider: "anthropic",
          model: "claude-sonnet-5",
          costUsd: usd,
          credits,
        })
        .run();
      expect(
        broken("the credits charged match the cost recorded"),
        `${usd} usd should be ${credits} credits`,
      ).toBe(false);
    }
  });

  it("finds cached tokens larger than the prompt they came from", () => {
    db.insert(llmCallsT)
      .values({
        id: newId("llm"),
        task: "write_module",
        provider: "anthropic",
        model: "claude-sonnet-5",
        tokensIn: 100,
        cacheReadTokens: 500,
      })
      .run();
    expect(broken("cached tokens never exceed the prompt they came from")).toBe(true);
  });

  it("finds two concepts fighting over one position in the path", () => {
    const { courseId } = readyCourseWithConcept();
    const second = newId("concept");
    db.insert(conceptsT)
      .values({ id: second, courseId, title: "D", summary: "s", topoOrder: 0 })
      .run();
    expect(broken("a module's concept order is unique within its course")).toBe(true);
  });

  it("reports the count and a sample, so a violation can be chased", () => {
    const { conceptId } = readyCourseWithConcept();
    addModule(conceptId);
    const found = checkInvariants([
      "a module in a finished course always has a live test",
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(1);
    expect(found[0]!.sample[0]).toHaveProperty("module_id");
    expect(formatViolations(found)).toContain("✗");
  });
});
