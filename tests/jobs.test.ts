import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-jobs-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, concepts, jobs, modules, questions } = await import(
  "@/db/schema"
);
const { enqueue, claimNext, markDone, recoverOrphaned } = await import(
  "@/lib/jobs/queue"
);
const { finishedConcepts } = await import("@/lib/jobs/handlers");
const { newId, now } = await import("@/lib/util/id");

beforeEach(() => {
  db.delete(jobs).run();
  db.delete(questions).run();
  db.delete(modules).run();
  db.delete(concepts).run();
  db.delete(courses).run();
});

describe("recoverOrphaned", () => {
  it("requeues work a stopped process left running", () => {
    enqueue("generate_course", { courseId: "course_1", actorUserId: null });
    const claimed = claimNext();
    expect(claimed?.status).toBe("running");

    // The process dies here: the row stays "running" and claimNext, which only
    // takes queued work, would never look at it again.
    expect(claimNext()).toBeNull();

    const recovered = recoverOrphaned();
    expect(recovered.requeued).toBe(1);
    expect(recovered.failed).toHaveLength(0);

    const again = claimNext();
    expect(again?.id).toBe(claimed?.id);
  });

  it("does not hand a second life to a job that used its last attempt", () => {
    const id = enqueue("generate_course", { courseId: "course_1", actorUserId: null }, { maxAttempts: 1 });
    claimNext();

    const recovered = recoverOrphaned();
    expect(recovered.requeued).toBe(0);
    expect(recovered.failed.map((j) => j.id)).toEqual([id]);

    const row = db.select().from(jobs).all()[0];
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/interrupted/i);
    expect(claimNext()).toBeNull();
  });

  it("leaves queued and finished work alone", () => {
    const running = enqueue("generate_course", { courseId: "a", actorUserId: null });
    const waiting = enqueue("generate_course", { courseId: "b", actorUserId: null });
    const finished = enqueue("generate_course", { courseId: "c", actorUserId: null });

    expect(claimNext()?.id).toBe(running);
    markDone(finished, { ok: true });

    const recovered = recoverOrphaned();
    expect(recovered.requeued).toBe(1);
    expect(recovered.failed).toHaveLength(0);

    const byId = new Map(
      db
        .select()
        .from(jobs)
        .all()
        .map((j) => [j.id, j.status]),
    );
    expect(byId.get(running)).toBe("queued");
    expect(byId.get(waiting)).toBe("queued");
    expect(byId.get(finished)).toBe("done");
  });
});

describe("finishedConcepts", () => {
  function seedConcept(courseId: string, title: string): string {
    const id = newId("concept");
    db.insert(concepts)
      .values({ id, courseId, title, summary: "s", depthLevel: 1 })
      .run();
    return id;
  }

  function seedModule(conceptId: string, status: "ready" | "pending") {
    db.insert(modules)
      .values({
        id: newId("module"),
        conceptId,
        kind: "concept",
        bodyMd: "# body",
        status,
        generatedAt: now(),
      })
      .run();
  }

  function seedQuestion(conceptId: string) {
    db.insert(questions)
      .values({
        id: newId("q"),
        conceptId,
        prompt: "p",
        expectedAnswer: "a",
        bloomLevel: "understand",
        format: "open",
      })
      .run();
  }

  beforeEach(() => {
    db.insert(courses)
      .values({
        id: "course_1",
        title: "Edge onboarding",
        sourcePrompt: "onboard the on-call engineer",
        lang: "en",
        status: "generating",
        createdAt: now(),
      })
      .run();
  });

  it("counts a module that is written and tested", () => {
    const c = seedConcept("course_1", "Failover");
    seedModule(c, "ready");
    seedQuestion(c);
    expect(finishedConcepts([c])).toEqual(new Set([c]));
  });

  it("does not count a module written without its tests", () => {
    // The window a restart can land in: the module row is committed, the
    // question generation call had not returned yet.
    const c = seedConcept("course_1", "Failover");
    seedModule(c, "ready");
    expect(finishedConcepts([c]).size).toBe(0);
  });

  it("does not count a module still being written", () => {
    const c = seedConcept("course_1", "Failover");
    seedModule(c, "pending");
    seedQuestion(c);
    expect(finishedConcepts([c]).size).toBe(0);
  });

  it("does not count a concept with no module at all", () => {
    const c = seedConcept("course_1", "Failover");
    expect(finishedConcepts([c]).size).toBe(0);
  });

  it("separates finished concepts from unfinished ones in the same course", () => {
    const done = seedConcept("course_1", "Failover");
    seedModule(done, "ready");
    seedQuestion(done);
    const todo = seedConcept("course_1", "Reading a 503");
    expect(finishedConcepts([done, todo])).toEqual(new Set([done]));
  });

  it("is empty for an empty course", () => {
    expect(finishedConcepts([]).size).toBe(0);
  });
});
