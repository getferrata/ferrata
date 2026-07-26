import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-import-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, enrollments, packages, users } = await import("@/db/schema");
const { importPackage } = await import("@/lib/package/import");
const { listCourses } = await import("@/lib/course/list");
const { canSeeCourse } = await import("@/lib/course/access");
const { newId, now } = await import("@/lib/util/id");
const { eq } = await import("drizzle-orm");

function seedUser(role: "student" | "examiner"): string {
  const id = newId("user");
  db.insert(users)
    .values({ id, email: `${id}@t.dev`, name: role, passwordHash: "x:y", role })
    .run();
  return id;
}

/** The smallest package the importer accepts. */
function samplePackage() {
  return {
    manifest: {
      title: "Edge onboarding",
      author: "Someone else",
      lang: "en",
      format: "ferrata" as const,
      version: 1 as const,
      license: null,
      sourceHash: "abc",
      moduleCount: 1,
      exportedAt: now(),
    },
    context: "how the edge gateway works",
    objective: "run the gateway on call",
    domain: "networking",
    concretenessRule: null,
    startLevel: null,
    scheduleMd: null,
    glossaryMd: null,
    budgetMinutes: 120,
    graph: {
      concepts: [
        {
          id: "c1",
          title: "Failover",
          summary: "what happens when the primary dies",
          priority: "high" as const,
          estimatedMinutes: 20,
          depthLevel: 1,
          topoOrder: 0,
        },
      ],
      edges: [],
    },
    modules: [
      { conceptId: "c1", title: "Failover", kind: "concept" as const, bodyMd: "# Failover" },
    ],
    questions: [
      {
        conceptId: "c1",
        prompt: "What fails over first?",
        expectedAnswer: "the gateway",
        bloomLevel: "understand" as const,
        format: "open" as const,
        optionsJson: null,
        misconceptionsJson: null,
      },
    ],
    cuts: [],
  };
}

beforeEach(() => {
  db.delete(enrollments).run();
  db.delete(packages).run();
  db.delete(courses).run();
  db.delete(users).run();
});

describe("an imported course belongs to whoever imported it", () => {
  it("records the importer as the owner", () => {
    const examiner = seedUser("examiner");
    const courseId = importPackage(samplePackage(), examiner);
    const row = db
      .select({ ownerId: courses.ownerId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    expect(row?.ownerId).toBe(examiner);
  });

  it("does not show up for a student who was never assigned it", () => {
    // Without an owner an import fell into the "everyone on this install" rule
    // meant for the seeded demo, so a package appeared in every student's list
    // the moment it was uploaded.
    const examiner = seedUser("examiner");
    const student = seedUser("student");
    const courseId = importPackage(samplePackage(), examiner);

    expect(
      listCourses({ userId: student, role: "student" }).map((c) => c.id),
    ).not.toContain(courseId);
    expect(canSeeCourse(courseId, { userId: student, role: "student" })).toBe(
      false,
    );
  });

  it("shows up on the examiner's own list, which it did not before", () => {
    // The same missing owner is why the roster page said "you haven't created
    // a course yet" right after an import.
    const examiner = seedUser("examiner");
    const courseId = importPackage(samplePackage(), examiner);
    expect(
      listCourses({ userId: examiner, role: "examiner" }).map((c) => c.id),
    ).toContain(courseId);
  });

  it("is hidden from a different examiner", () => {
    const mine = seedUser("examiner");
    const theirs = seedUser("examiner");
    const courseId = importPackage(samplePackage(), mine);
    expect(canSeeCourse(courseId, { userId: theirs, role: "examiner" })).toBe(
      false,
    );
  });

  it("becomes visible to a student once they are enrolled", () => {
    const examiner = seedUser("examiner");
    const student = seedUser("student");
    const courseId = importPackage(samplePackage(), examiner);
    db.insert(enrollments)
      .values({ id: newId("enr"), courseId, userId: student })
      .run();
    expect(
      listCourses({ userId: student, role: "student" }).map((c) => c.id),
    ).toContain(courseId);
  });

  it("arrives unchecked, and the package ledger agrees", () => {
    const examiner = seedUser("examiner");
    const courseId = importPackage(samplePackage(), examiner);
    const course = db
      .select({ origin: courses.origin, verifiedAt: courses.verifiedAt })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    expect(course?.origin).toBe("imported");
    expect(course?.verifiedAt).toBeNull();

    const pkg = db
      .select({ trusted: packages.trusted })
      .from(packages)
      .where(eq(packages.courseId, courseId))
      .get();
    expect(pkg?.trusted).toBe(false);
  });
});
