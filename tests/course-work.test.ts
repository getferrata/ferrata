import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-work-")),
  "test.db",
);

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { jobs } = await import("@/db/schema");
const { enqueue, claimNext, markDone, markFailed } = await import(
  "@/lib/jobs/queue"
);
const { courseWork, moduleWork } = await import("@/lib/course/work");

beforeEach(() => {
  db.delete(jobs).run();
});

/** Push a job's clock back, to write a history without waiting for one. */
function age(id: string, minutes: number): void {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get()!;
  db.update(jobs)
    .set({ updatedAt: row.updatedAt - minutes * 60_000 })
    .where(eq(jobs.id, id))
    .run();
}

describe("courseWork", () => {
  it("says nothing when the queue holds nothing for this course", () => {
    enqueue("generate_course", { courseId: "other", actorUserId: null });
    const work = courseWork("mine");
    expect(work.active).toEqual([]);
    expect(work.failed).toEqual([]);
    expect(work.rewriting).toEqual([]);
  });

  it("separates what is waiting from what is running", () => {
    enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k2",
      actorUserId: null,
    });
    claimNext();

    const work = courseWork("c1");
    expect(work.active).toHaveLength(2);
    expect(work.active.filter((a) => a.status === "running")).toHaveLength(1);
    expect(work.active.filter((a) => a.status === "queued")).toHaveLength(1);
    // Both are on their way, so both modules are marked on the route: an author
    // told only about the running one would think the second click was lost.
    expect(new Set(work.rewriting)).toEqual(new Set(["k1", "k2"]));
  });

  it("does not mistake one course for another whose id differs by a character", () => {
    // Underscores are wildcards to SQL LIKE, so the prefilter alone matches
    // both of these. The substring check after it is what tells them apart.
    enqueue("generate_course", { courseId: "course_a1b2", actorUserId: null });
    enqueue("generate_course", { courseId: "courseXa1b2", actorUserId: null });
    expect(courseWork("course_a1b2").active).toHaveLength(1);
  });

  it("reports the reason a job stopped, which is the whole point of showing it", () => {
    const id = enqueue(
      "regenerate_module",
      { courseId: "c1", conceptId: "k1", actorUserId: null },
      { maxAttempts: 1 },
    );
    const job = claimNext()!;
    markFailed(job, "no API key configured");

    const work = courseWork("c1");
    expect(work.active).toEqual([]);
    expect(work.failed).toEqual([
      { type: "regenerate_module", error: "no API key configured", at: expect.any(Number) },
    ]);
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()?.status).toBe(
      "failed",
    );
  });

  it("stops reporting a failure once the same work has since succeeded", () => {
    const failed = enqueue(
      "check_sources",
      { courseId: "c1", actorUserId: null },
      { maxAttempts: 1 },
    );
    markFailed(
      { ...db.select().from(jobs).where(eq(jobs.id, failed)).get()!, attempts: 1 },
      "the host did not answer",
    );
    age(failed, 30);
    expect(courseWork("c1").failed).toHaveLength(1);

    // A later run of the same kind of work went through. The old red banner is
    // now a lie, and a banner the author learns to ignore is worse than none.
    enqueue("check_sources", { courseId: "c1", actorUserId: null });
    const retry = claimNext()!;
    markDone(retry.id, { ok: true });

    expect(courseWork("c1").failed).toEqual([]);
  });

  it("keeps a failure that is newer than the last success", () => {
    const ok = enqueue("check_sources", { courseId: "c1", actorUserId: null });
    markDone(claimNext()!.id, { ok: true });
    age(ok, 60);

    const bad = enqueue(
      "check_sources",
      { courseId: "c1", actorUserId: null },
      { maxAttempts: 1 },
    );
    markFailed(
      { ...db.select().from(jobs).where(eq(jobs.id, bad)).get()!, attempts: 1 },
      "the host did not answer",
    );

    expect(courseWork("c1").failed.map((f) => f.error)).toEqual([
      "the host did not answer",
    ]);
  });

  it("only counts a retry that is still waiting as one piece of work", () => {
    const id = enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    const job = claimNext()!;
    // Attempts remain, so this goes back to queued rather than failing.
    markFailed(job, "the model timed out");

    const work = courseWork("c1");
    expect(work.active.map((a) => a.status)).toEqual(["queued"]);
    // Queued to run again is not a failure to report: nobody has given up yet.
    expect(work.failed).toEqual([]);
    expect(work.rewriting).toEqual(["k1"]);
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()?.status).toBe(
      "queued",
    );
  });
});

describe("moduleWork", () => {
  it("is idle when the module has never been rewritten", () => {
    expect(moduleWork("k1")).toEqual({ state: "idle" });
  });

  it("distinguishes waiting from running", () => {
    enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    expect(moduleWork("k1").state).toBe("queued");
    claimNext();
    expect(moduleWork("k1").state).toBe("running");
  });

  it("carries the reason forward when the rewrite stopped", () => {
    enqueue(
      "regenerate_module",
      { courseId: "c1", conceptId: "k1", actorUserId: null },
      { maxAttempts: 1 },
    );
    markFailed(claimNext()!, "the model returned nothing");
    const work = moduleWork("k1");
    expect(work.state).toBe("failed");
    if (work.state === "failed") {
      expect(work.error).toBe("the model returned nothing");
    }
  });

  it("goes quiet once a later attempt succeeded", () => {
    const first = enqueue(
      "regenerate_module",
      { courseId: "c1", conceptId: "k1", actorUserId: null },
      { maxAttempts: 1 },
    );
    markFailed(claimNext()!, "the model returned nothing");
    age(first, 30);

    enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    markDone(claimNext()!.id, { ok: true });

    // The module on the page is the one the successful rewrite wrote, so the
    // older failure describes a body nobody is reading any more.
    expect(moduleWork("k1")).toEqual({ state: "idle" });
  });

  it("does not answer for a different module", () => {
    enqueue("regenerate_module", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    expect(moduleWork("k2")).toEqual({ state: "idle" });
  });

  it("ignores work of another kind that names the same concept", () => {
    enqueue("propose_updates", {
      courseId: "c1",
      conceptId: "k1",
      actorUserId: null,
    });
    claimNext();
    expect(moduleWork("k1")).toEqual({ state: "idle" });
    // The course-wide panel still has it, filed under its own kind.
    expect(courseWork("c1").active.map((a) => a.type)).toEqual([
      "propose_updates",
    ]);
  });
});
