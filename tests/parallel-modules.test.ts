import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-parallel-")),
  "test.db",
);
// Lite mode keeps one call per module, so what this file measures is the shape
// of the loop around the modules rather than the quality loop inside one. The
// pool wraps both the same way.
process.env.FERRATA_LITE = "1";
process.env.FERRATA_MODULE_CONCURRENCY = "4";

const runWriteModule = vi.fn();
const runWriteQuestions = vi.fn();

vi.mock("@/lib/llm/tasks/write_module", () => ({
  runWriteModule,
  verifyModule: () => ({ hard: [], soft: [] }),
}));
vi.mock("@/lib/llm/tasks/write_questions", () => ({
  runWriteQuestions,
  questionsSchema: {},
}));
vi.mock("@/lib/llm/tasks/glossary", () => ({
  runGlossary: async () => ({ glossaryMd: "# terms" }),
}));
vi.mock("@/lib/llm/tasks/schedule", () => ({
  runSchedule: async () => ({ scheduleMd: "# plan" }),
}));

const { eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const {
  concepts: conceptsT,
  courses: coursesT,
  modules: modulesT,
  questions: questionsT,
} = await import("@/db/schema");
const { HANDLERS } = await import("@/lib/jobs/handlers");
const { newId } = await import("@/lib/util/id");

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

function seed(titles: string[]): string {
  const courseId = newId("course");
  db.insert(coursesT)
    .values({
      id: courseId,
      title: "Course",
      sourcePrompt: "brief",
      lang: "en",
      status: "generating",
    })
    .run();
  titles.forEach((title, i) => {
    db.insert(conceptsT)
      .values({
        id: newId("concept"),
        courseId,
        title,
        summary: `about ${title}`,
        topoOrder: i,
      })
      .run();
  });
  return courseId;
}

/** Modules written for this course, however many lanes wrote them. */
function writtenFor(courseId: string): number {
  const conceptIds = db
    .select({ id: conceptsT.id })
    .from(conceptsT)
    .where(eq(conceptsT.courseId, courseId))
    .all()
    .map((c) => c.id);
  if (conceptIds.length === 0) return 0;
  return db
    .select({ id: modulesT.id })
    .from(modulesT)
    .where(inArray(modulesT.conceptId, conceptIds))
    .all().length;
}

beforeEach(() => {
  db.delete(questionsT).run();
  db.delete(modulesT).run();
  db.delete(conceptsT).run();
  db.delete(coursesT).run();
  runWriteModule.mockReset();
  runWriteQuestions.mockReset();
  runWriteQuestions.mockResolvedValue({
    questions: [
      {
        prompt: "why?",
        expectedAnswer: "because",
        bloomLevel: "understand",
        format: "open",
        options: null,
        misconceptions: [],
      },
    ],
  });
});

describe("building the modules of a course", () => {
  it("writes several at a time instead of one after another", async () => {
    let running = 0;
    let peak = 0;
    runWriteModule.mockImplementation(async (args: { conceptTitle: string }) => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return { bodyMd: `# ${args.conceptTitle}` };
    });

    const courseId = seed(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const result = await HANDLERS.generate_course!({ courseId });

    expect(result).toMatchObject({ modules: 8 });
    expect(peak).toBe(4);
    expect(writtenFor(courseId)).toBe(8);
  });

  it("writes every module exactly once", async () => {
    // The pool hands each item to one lane. A module written twice would be
    // billed twice and the second write would retire the first one's questions.
    runWriteModule.mockImplementation(async (args: { conceptTitle: string }) => {
      await tick();
      return { bodyMd: `# ${args.conceptTitle}` };
    });

    const courseId = seed(["a", "b", "c", "d", "e"]);
    await HANDLERS.generate_course!({ courseId });

    const asked = runWriteModule.mock.calls.map((c) => c[0].conceptTitle);
    expect(asked.slice().sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(writtenFor(courseId)).toBe(5);
  });

  it("keeps building when one module fails in another lane", async () => {
    // The old loop caught this per iteration. Running in parallel must not turn
    // one bad module into a course that stops where it happened.
    runWriteModule.mockImplementation(async (args: { conceptTitle: string }) => {
      await tick();
      if (args.conceptTitle === "c") throw new Error("the model refused");
      return { bodyMd: `# ${args.conceptTitle}` };
    });

    const courseId = seed(["a", "b", "c", "d"]);
    const result = await HANDLERS.generate_course!({ courseId });

    expect(result).toMatchObject({ modules: 3 });
    expect(writtenFor(courseId)).toBe(3);
    // The course still finishes: three modules are a course, and the author is
    // told what is missing by the module count rather than by a failed build.
    expect(
      db.select().from(coursesT).where(eq(coursesT.id, courseId)).get()?.status,
    ).toBe("ready");
  });

  it("still fails the build when nothing at all could be written", async () => {
    runWriteModule.mockRejectedValue(new Error("no provider"));
    const courseId = seed(["a", "b"]);
    await expect(HANDLERS.generate_course!({ courseId })).rejects.toThrow(
      /no modules generated/,
    );
  });

  it("does not rewrite a module that is already finished", async () => {
    // Resume after a restart: the concurrency changes nothing about what has
    // already been paid for.
    runWriteModule.mockImplementation(async (args: { conceptTitle: string }) => ({
      bodyMd: `# ${args.conceptTitle}`,
    }));

    const courseId = seed(["a", "b", "c"]);
    await HANDLERS.generate_course!({ courseId });
    runWriteModule.mockClear();

    await HANDLERS.generate_course!({ courseId });
    expect(runWriteModule).not.toHaveBeenCalled();
  });
});
