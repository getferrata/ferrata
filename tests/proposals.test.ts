import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-proposals-")),
  "test.db",
);

const { db } = await import("@/db");
const { concepts, courses, cuts, edges, jobs, modules, proposals, questions, reviews } =
  await import("@/db/schema");
const { applyProposal, decideProposal, pendingProposals, recordProposals } =
  await import("@/lib/course/proposals");
const { enqueueRegenerateModuleOnce } = await import("@/lib/jobs/queue");
const { newId, now } = await import("@/lib/util/id");
const { eq } = await import("drizzle-orm");

function seedCourse(): string {
  const id = newId("course");
  db.insert(courses)
    .values({ id, title: "t", sourcePrompt: "p", lang: "it", status: "ready" })
    .run();
  return id;
}

function seedConcept(courseId: string, title: string, topoOrder = 0): string {
  const id = newId("concept");
  db.insert(concepts)
    .values({ id, courseId, title, summary: "s", depthLevel: 1, topoOrder })
    .run();
  return id;
}

beforeEach(() => {
  for (const t of [reviews, questions, modules, proposals, cuts, edges, jobs, concepts, courses]) {
    db.delete(t).run();
  }
});

describe("recording what the model proposed", () => {
  it("resolves concept indexes against the list the prompt showed", () => {
    const courseId = seedCourse();
    const a = seedConcept(courseId, "Gateway");
    const b = seedConcept(courseId, "Failover", 1);
    const stored = recordProposals(
      courseId,
      [
        { kind: "update_module", conceptIndex: 1, candidate: null, reason: "r1" },
      ],
      [
        { id: a, title: "Gateway" },
        { id: b, title: "Failover" },
      ],
    );
    expect(stored).toBe(1);
    const row = pendingProposals(courseId)[0]!;
    expect(row.conceptId).toBe(b);
    expect(row.title).toBe("Failover");
  });

  it("drops an index the model invented instead of storing noise", () => {
    const courseId = seedCourse();
    const a = seedConcept(courseId, "Gateway");
    const stored = recordProposals(
      courseId,
      [
        { kind: "retire_concept", conceptIndex: 7, candidate: null, reason: "r" },
        { kind: "update_module", conceptIndex: null, candidate: null, reason: "r" },
        { kind: "add_concept", conceptIndex: null, candidate: null, reason: "r" },
      ],
      [{ id: a, title: "Gateway" }],
    );
    expect(stored).toBe(0);
    expect(pendingProposals(courseId)).toEqual([]);
  });
});

describe("the author's decision is the only thing that applies", () => {
  it("approving an update queues a rewrite of that concept", () => {
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    recordProposals(
      courseId,
      [{ kind: "update_module", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: conceptId, title: "Gateway" }],
    );
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "user_1",
    )!;
    const applied = applyProposal(row, "user_1");
    expect(applied).toEqual({ ok: true, effect: "queued_rewrite" });

    const job = db.select().from(jobs).all()[0]!;
    expect(job.type).toBe("regenerate_module");
    expect(job.payloadJson).toContain(conceptId);
    // Whoever approved pays: the actor travels in the payload.
    expect(job.payloadJson).toContain("user_1");
  });

  it("approving an addition inserts the concept at the end and queues its module", () => {
    const courseId = seedCourse();
    seedConcept(courseId, "Gateway", 4);
    recordProposals(
      courseId,
      [
        {
          kind: "add_concept",
          conceptIndex: null,
          candidate: {
            title: "Rate limiting",
            summary: "sheds load before the pool empties",
            priority: "high",
            estimatedMinutes: 25,
            depthLevel: 2,
          },
          reason: "r",
        },
      ],
      [],
    );
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "user_1",
    )!;
    const applied = applyProposal(row, "user_1");
    expect(applied).toEqual({ ok: true, effect: "queued_new_module" });

    const added = db
      .select()
      .from(concepts)
      .where(eq(concepts.courseId, courseId))
      .all()
      .find((c) => c.title === "Rate limiting")!;
    // After the existing path, not resequencing a course people are mid-way
    // through.
    expect(added.topoOrder).toBe(5);
    expect(db.select().from(jobs).all()[0]!.payloadJson).toContain(added.id);
  });

  it("approving a retirement records the cut and removes the concept", () => {
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Failover");
    db.insert(modules)
      .values({ id: newId("m"), conceptId, kind: "concept", bodyMd: "b", status: "ready" })
      .run();
    recordProposals(
      courseId,
      [{ kind: "retire_concept", conceptIndex: 0, candidate: null, reason: "the platform team owns it now" }],
      [{ id: conceptId, title: "Failover" }],
    );
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "user_1",
    )!;
    expect(applyProposal(row, "user_1")).toEqual({ ok: true, effect: "retired" });

    // Retired, not deleted. A delete cascades into the answers students already
    // gave, and this proposal was written by a model reading uploaded material:
    // not a provenance worth destroying somebody's record on.
    const c = db.select().from(concepts).where(eq(concepts.id, conceptId)).get();
    expect(c).toBeDefined();
    expect(c?.retiredAt).toEqual(expect.any(Number));
    const cut = db.select().from(cuts).all()[0]!;
    expect(cut.title).toBe("Failover");
    expect(cut.reason).toContain("platform team");
  });

  it("cannot apply the same proposal twice", () => {
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    recordProposals(
      courseId,
      [{ kind: "update_module", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: conceptId, title: "Gateway" }],
    );
    const id = pendingProposals(courseId)[0]!.id;
    expect(decideProposal(id, courseId, "approved", "u")).not.toBeNull();
    // Second decision, any kind: nothing pending, nothing happens.
    expect(decideProposal(id, courseId, "approved", "u")).toBeNull();
    expect(decideProposal(id, courseId, "dismissed", "u")).toBeNull();
  });

  it("refuses to act on a proposal from another course", () => {
    const courseA = seedCourse();
    const courseB = seedCourse();
    const conceptId = seedConcept(courseA, "Gateway");
    recordProposals(
      courseA,
      [{ kind: "update_module", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: conceptId, title: "Gateway" }],
    );
    const id = pendingProposals(courseA)[0]!.id;
    // The decision endpoint passes the course from the URL; a proposal id from
    // a different course must not resolve.
    expect(decideProposal(id, courseB, "approved", "u")).toBeNull();
  });

  it("survives the concept vanishing between proposal and approval", () => {
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Failover");
    recordProposals(
      courseId,
      [{ kind: "update_module", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: conceptId, title: "Failover" }],
    );
    db.delete(concepts).where(eq(concepts.id, conceptId)).run();
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "u",
    )!;
    const applied = applyProposal(row, "u");
    expect(applied.ok).toBe(false);
    expect(db.select().from(jobs).all()).toEqual([]);
  });
});

describe("the checklist does not stack duplicates", () => {
  it("skips a proposal already pending for the same target", () => {
    // The job is retried after a crash and the author can upload the same
    // file twice; the author must not be asked the same question twice.
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    const shown = [{ id: conceptId, title: "Gateway" }];
    const items = [
      { kind: "update_module" as const, conceptIndex: 0, candidate: null, reason: "r" },
      {
        kind: "add_concept" as const,
        conceptIndex: null,
        candidate: {
          title: "Rate limiting",
          summary: "s",
          priority: "high" as const,
          estimatedMinutes: 20,
          depthLevel: 2,
        },
        reason: "r",
      },
    ];
    expect(recordProposals(courseId, items, shown)).toBe(2);
    expect(recordProposals(courseId, items, shown)).toBe(0);
    expect(pendingProposals(courseId)).toHaveLength(2);
  });

  it("allows the same target again once the earlier proposal was decided", () => {
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    const shown = [{ id: conceptId, title: "Gateway" }];
    const items = [
      { kind: "update_module" as const, conceptIndex: 0, candidate: null, reason: "r" },
    ];
    recordProposals(courseId, items, shown);
    decideProposal(pendingProposals(courseId)[0]!.id, courseId, "dismissed", "u");
    // New material later can legitimately re-propose the same module.
    expect(recordProposals(courseId, items, shown)).toBe(1);
  });
});

describe("retiring removes the arrows too", () => {
  it("deletes the prerequisite edges touching the retired concept", () => {
    // edges carries no foreign key to concepts, so without this the graph
    // keeps arrows pointing at a node that no longer exists.
    const courseId = seedCourse();
    const a = seedConcept(courseId, "Gateway");
    const b = seedConcept(courseId, "Failover", 1);
    const c = seedConcept(courseId, "Reading a 503", 2);
    for (const [from, to] of [
      [a, b],
      [b, c],
    ] as const) {
      db.insert(edges)
        .values({ id: newId("edge"), courseId, fromConceptId: from, toConceptId: to })
        .run();
    }
    recordProposals(
      courseId,
      [{ kind: "retire_concept", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: b, title: "Failover" }],
    );
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "u",
    )!;
    expect(applyProposal(row, "u")).toEqual({ ok: true, effect: "retired" });

    const left = db.select().from(edges).all();
    expect(left).toHaveLength(0);
  });
});

describe("dedup inside a single model response", () => {
  it("stores one card when the model names the same concept twice in one batch", () => {
    // The snapshot-before-loop guard missed same-batch duplicates: nothing in
    // the schema forbids a response listing conceptIndex 0 twice.
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    const stored = recordProposals(
      courseId,
      [
        { kind: "update_module", conceptIndex: 0, candidate: null, reason: "the failover section changed" },
        { kind: "update_module", conceptIndex: 0, candidate: null, reason: "the timeout values changed" },
      ],
      [{ id: conceptId, title: "Gateway" }],
    );
    expect(stored).toBe(1);
    expect(pendingProposals(courseId)).toHaveLength(1);
  });

  it("stores one card for a repeated add_concept title in one batch", () => {
    const courseId = seedCourse();
    const candidate = {
      title: "Rate limiting",
      summary: "s",
      priority: "high" as const,
      estimatedMinutes: 20,
      depthLevel: 2,
    };
    const stored = recordProposals(
      courseId,
      [
        { kind: "add_concept", conceptIndex: null, candidate, reason: "r1" },
        { kind: "add_concept", conceptIndex: null, candidate, reason: "r2" },
      ],
      [],
    );
    expect(stored).toBe(1);
  });
});

describe("one rewrite per concept, whichever path asks", () => {
  it("does not queue a second regenerate when one for the concept is in flight", () => {
    // The manual button and an approved proposal can both target the same
    // concept; the single-lane worker would run the whole loop twice.
    const courseId = seedCourse();
    const conceptId = seedConcept(courseId, "Gateway");
    recordProposals(
      courseId,
      [{ kind: "update_module", conceptIndex: 0, candidate: null, reason: "r" }],
      [{ id: conceptId, title: "Gateway" }],
    );
    // A rewrite is already queued (as the manual button would).
    expect(enqueueRegenerateModuleOnce(courseId, conceptId, "u")).toBe(true);
    // Approving the proposal must not queue a second.
    const row = decideProposal(
      pendingProposals(courseId)[0]!.id,
      courseId,
      "approved",
      "u",
    )!;
    applyProposal(row, "u");
    const jobRows = db
      .select()
      .from(jobs)
      .all()
      .filter((j) => j.type === "regenerate_module");
    expect(jobRows).toHaveLength(1);
  });
});
