import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-jobs-")),
  "test.db",
);

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { courses, concepts, jobs, modules, questions } = await import(
  "@/db/schema"
);
const {
  enqueue,
  enqueueRegenerateModuleOnce,
  claimNext,
  jobCourseId,
  markDone,
  abandonOverdue,
  recoverOrphaned,
} = await import("@/lib/jobs/queue");
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
    // Claimed before it is finished, because that is the only way a job ever
    // reaches markDone: the worker marks what it is holding. Marking an
    // unclaimed row done would be a state no code path produces.
    expect(claimNext(new Set(["a", "b"]))?.id).toBe(finished);
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

describe("who a job belongs to", () => {
  it("records the actor as a column, not only inside the payload", () => {
    // Ownership used to be asked by looking for the user's id as a substring of
    // the payload blob. Right only while no second id lives in the same
    // payload: the day one gains a courseId the match goes ambiguous and no
    // test notices, because the behaviour stays correct until two ids collide.
    const id = enqueue("preflight", { actorUserId: "user_abc", runId: "pf_1" });
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row?.actorUserId).toBe("user_abc");
  });

  it("leaves it null for work nobody triggered", () => {
    const id = enqueue("preflight", { actorUserId: null, runId: "pf_2" });
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row?.actorUserId).toBeNull();
  });

  it("keeps the actor through a claim, which is when the guard has to see it", () => {
    // The window a duplicate-run guard has to cover is the running one: queued
    // lasts a second or two, running lasts minutes.
    const id = enqueue("preflight", { actorUserId: "user_xyz", runId: "pf_3" });
    const claimed = claimNext();
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe("running");
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row?.actorUserId).toBe("user_xyz");
    expect(row?.status).toBe("running");
  });
});

describe("queuing a rewrite against what readers got wrong", () => {
  it("carries the flag to the worker, which runs far from the click", () => {
    // The worker cannot ask the page why it was asked to rewrite. The payload
    // is the whole message, so the flag being in it is the feature working.
    enqueueRegenerateModuleOnce("course_a", "concept_a", "user_1", true);
    const row = db.select().from(jobs).get();
    expect(JSON.parse(row!.payloadJson)).toMatchObject({
      conceptId: "concept_a",
      useFailures: true,
    });
  });

  it("defaults to off, so a plain rewrite stays a plain rewrite", () => {
    enqueueRegenerateModuleOnce("course_a", "concept_a", "user_1");
    const row = db.select().from(jobs).get();
    expect(JSON.parse(row!.payloadJson).useFailures).toBe(false);
  });

  it("still deduplicates when the two callers disagree about the flag", () => {
    // The dashboard button and the module page button reach the same worker.
    // Letting the flag split the guard would run the loop twice, bill twice,
    // and have the second run delete the questions the first just wrote.
    expect(
      enqueueRegenerateModuleOnce("course_a", "concept_a", "user_1", true),
    ).toBe(true);
    expect(
      enqueueRegenerateModuleOnce("course_a", "concept_a", "user_1", false),
    ).toBe(false);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });
});

describe("claiming work across lanes", () => {
  it("keeps one course in one lane", () => {
    // The stages of a build are ordered, and two jobs on the same course would
    // write every module twice and bill for both. Lanes exist to run other
    // people's courses, not to split one course across them.
    enqueue("generate_course", { courseId: "course_a", actorUserId: null });
    enqueue("regenerate_module", {
      courseId: "course_a",
      conceptId: "c1",
      actorUserId: null,
    });

    const first = claimNext();
    expect(jobCourseId(first!.payloadJson)).toBe("course_a");
    expect(claimNext(new Set(["course_a"]))).toBeNull();
  });

  it("does not make the second author wait behind the first one's build", () => {
    // The whole point of the lanes: a twenty-minute course in flight must not
    // be why somebody else's course has not started.
    enqueue("generate_course", { courseId: "course_a", actorUserId: null });
    const second = enqueue("generate_course", {
      courseId: "course_b",
      actorUserId: null,
    });

    claimNext();
    expect(claimNext(new Set(["course_a"]))?.id).toBe(second);
  });

  it("skips past a busy course to reach work that can run", () => {
    // Queue order puts two blocked jobs in front of a runnable one. Claiming
    // has to look past them rather than report an idle install.
    const older = now() - 1000;
    enqueue("generate_course", { courseId: "busy", actorUserId: null }, { runAfter: older });
    enqueue("regenerate_module", { courseId: "busy", conceptId: "c", actorUserId: null }, { runAfter: older });
    const free = enqueue("generate_course", { courseId: "free", actorUserId: null });

    expect(claimNext(new Set(["busy"]))?.id).toBe(free);
  });

  it("always claims work that belongs to no course", () => {
    // Preflight spends on a fixture, not on a course, so nothing it could
    // collide with is in flight.
    const id = enqueue("preflight", { runId: "run_1", actorUserId: null });
    expect(claimNext(new Set(["course_a", "course_b"]))?.id).toBe(id);
  });

  it("frees the course again once its job is done", () => {
    enqueue("generate_course", { courseId: "course_a", actorUserId: null });
    const queued = enqueue("regenerate_module", {
      courseId: "course_a",
      conceptId: "c1",
      actorUserId: null,
    });

    const running = claimNext();
    expect(claimNext(new Set(["course_a"]))).toBeNull();
    markDone(running!.id, { ok: true });
    // The worker drops the course from its in-flight set here, so the next
    // tick passes an empty one.
    expect(claimNext()?.id).toBe(queued);
  });

  it("reads the course off a payload it cannot parse without throwing", () => {
    expect(jobCourseId("not json")).toBeNull();
    expect(jobCourseId(JSON.stringify({ actorUserId: "u" }))).toBeNull();
    expect(jobCourseId(JSON.stringify({ courseId: 42 }))).toBeNull();
  });
});

describe("a job that runs past its deadline is given up on", () => {
  /**
   * The gap this closes is narrow and was invisible. A process that dies mid
   * job is already recovered at the next startup, because one worker means
   * anything left running belongs to a process that is gone. A handler that
   * hangs while the worker is alive had nothing: no timeout, no recovery, no
   * sign on any page, and the only cure a restart nobody knew to perform.
   *
   * Abandoning is not stopping. Nothing here can cancel a promise already in
   * flight; what changes is that the lane and the course stop waiting on it.
   */
  const MINUTE = 60_000;

  function running(type: string, ageMinutes: number, attempts = 1): string {
    const id = newId("job");
    const at = now() - ageMinutes * MINUTE;
    db.insert(jobs)
      .values({
        id,
        type,
        payloadJson: JSON.stringify({ courseId: "c1" }),
        status: "running",
        attempts,
        maxAttempts: 3,
        runAfter: at,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    return id;
  }

  const statusOf = (id: string) =>
    db.select().from(jobs).where(eq(jobs.id, id)).get();

  it("leaves alone one that is merely slow", () => {
    // A full course build really does take twenty minutes. Policing slowness
    // would abandon correct work halfway and charge for it twice.
    const id = running("generate_course", 40);
    expect(abandonOverdue()).toHaveLength(0);
    expect(statusOf(id)?.status).toBe("running");
  });

  it("gives up on one past the deadline for its type", () => {
    const id = running("regenerate_module", 45);
    const gone = abandonOverdue();
    expect(gone).toHaveLength(1);
    expect(statusOf(id)?.status).toBe("queued");
    expect(statusOf(id)?.error).toContain("stopped waiting");
  });

  it("holds each type to its own deadline, not one number for all", () => {
    // 45 minutes is past a module rewrite and nowhere near a course build.
    const build = running("generate_course", 45);
    const rewrite = running("regenerate_module", 45);
    abandonOverdue();
    expect(statusOf(build)?.status).toBe("running");
    expect(statusOf(rewrite)?.status).toBe("queued");
  });

  it("retries when attempts remain, since a hung call usually lands next time", () => {
    const id = running("regenerate_module", 45, 1);
    abandonOverdue();
    expect(statusOf(id)?.status).toBe("queued");
  });

  it("fails for good when they do not", () => {
    const id = running("regenerate_module", 45, 3);
    abandonOverdue();
    expect(statusOf(id)?.status).toBe("failed");
  });

  it("refuses a late result for a job already given up on", () => {
    // The handler may still return. It must not resurrect a row somebody else
    // is now working, nor report success for work already written off.
    const id = running("regenerate_module", 45);
    abandonOverdue();
    markDone(id, { ok: true });
    expect(statusOf(id)?.status).toBe("queued");
  });

  it("still accepts a result from a job that is genuinely running", () => {
    const id = running("regenerate_module", 1);
    markDone(id, { ok: true });
    expect(statusOf(id)?.status).toBe("done");
  });
});
