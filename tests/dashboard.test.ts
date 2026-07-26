import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-dash-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, concepts, explanations, modules, questions } = await import(
  "@/db/schema"
);
const { getDashboard } = await import("@/lib/course/dashboard");
const { newId, now } = await import("@/lib/util/id");

function seedCourse() {
  const courseId = newId("course");
  db.insert(courses)
    .values({
      id: courseId,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
      createdAt: now(),
    })
    .run();
  const mk = (title: string) => {
    const id = newId("concept");
    db.insert(concepts)
      .values({
        id,
        courseId,
        title,
        summary: "s",
        depthLevel: 1,
      })
      .run();
    db.insert(modules)
      .values({
        id: newId("module"),
        conceptId: id,
        kind: "concept",
        bodyMd: "body",
        status: "ready",
        generatedAt: now(),
      })
      .run();
    db.insert(questions)
      .values({
        id: newId("q"),
        conceptId: id,
        prompt: "why?",
        expectedAnswer: "because",
        bloomLevel: "understand",
        format: "open",
        misconceptionsJson: "[]",
      })
      .run();
    return id;
  };
  return { courseId, a: mk("Gateway"), b: mk("Failover"), c: mk("Stores") };
}

describe("getDashboard explain-back evidence", () => {
  it("reports the latest explanation verdict per concept and counts clean ones", () => {
    const { courseId, a, b } = seedCourse();
    // Concept a: first gappy, then complete. Latest wins.
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: null,
        complete: false,
        gap: "missed VRRP",
        createdAt: 100,
      })
      .run();
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: null,
        complete: true,
        gap: "",
        createdAt: 200,
      })
      .run();
    // Concept b: one gappy attempt.
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: b,
        userId: null,
        complete: false,
        gap: "no failover timing",
        createdAt: 150,
      })
      .run();

    const d = getDashboard(courseId);
    expect(d).not.toBeNull();
    const byTitle = new Map(d!.concepts.map((c) => [c.title, c.explained]));
    expect(byTitle.get("Gateway")).toBe("complete");
    expect(byTitle.get("Failover")).toBe("gappy");
    expect(byTitle.get("Stores")).toBeNull();
    expect(d!.explainedCount).toBe(1);
  });

  it("scopes explanations to the requested student", () => {
    const { courseId, a } = seedCourse();
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: "user_other",
        complete: true,
        gap: "",
        createdAt: 100,
      })
      .run();
    const d = getDashboard(courseId, new Date(), "user_me");
    expect(d!.explainedCount).toBe(0);
    const other = getDashboard(courseId, new Date(), "user_other");
    expect(other!.explainedCount).toBe(1);
  });
});
