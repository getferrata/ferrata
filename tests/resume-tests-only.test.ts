import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  modules as modulesT,
  questions as questionsT,
  users as usersT,
} from "@/db/schema";
import { finishedConcepts, untestedConcepts } from "@/lib/jobs/handlers";
import { newId, now } from "@/lib/util/id";

function seedCourse(): { courseId: string; conceptId: string } {
  const userId = newId("user");
  db.insert(usersT)
    .values({
      id: userId,
      email: `${userId}@example.test`,
      passwordHash: "x",
      role: "examiner",
      name: "Author",
    })
    .run();
  const courseId = newId("course");
  db.insert(coursesT)
    .values({
      id: courseId,
      ownerId: userId,
      title: "Course",
      sourcePrompt: "brief",
      lang: "en",
      status: "generating",
    })
    .run();
  const conceptId = newId("concept");
  db.insert(conceptsT)
    .values({
      id: conceptId,
      courseId,
      title: "Concept",
      summary: "summary",
      topoOrder: 0,
    })
    .run();
  return { courseId, conceptId };
}

function addModule(conceptId: string, bodyMd: string | null): string {
  const id = newId("module");
  db.insert(modulesT)
    .values({ id, conceptId, bodyMd, status: "ready", generatedAt: now() })
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

describe("resuming a half-built course", () => {
  let courseId: string;
  let conceptId: string;

  beforeEach(() => {
    ({ courseId, conceptId } = seedCourse());
  });

  it("counts a module with a body and a live test as finished", () => {
    addModule(conceptId, "## Body");
    addQuestion(conceptId);
    expect(finishedConcepts([conceptId]).has(conceptId)).toBe(true);
    expect(untestedConcepts([conceptId]).has(conceptId)).toBe(false);
  });

  it("hands back the stored body when the tests never arrived", () => {
    // The expensive case: the body was written, judged and accepted, and only
    // the last call failed. Rewriting it costs four calls to replace something
    // already good, every time the worker comes back.
    const moduleId = addModule(conceptId, "## Body");
    expect(finishedConcepts([conceptId]).has(conceptId)).toBe(false);
    expect(untestedConcepts([conceptId]).get(conceptId)).toEqual({
      moduleId,
      bodyMd: "## Body",
    });
  });

  it("treats a module whose only tests are retired as untested", () => {
    // Retired questions are the record of what students already answered, not
    // something to study. A module left holding only those needs new ones.
    addModule(conceptId, "## Body");
    addQuestion(conceptId, true);
    expect(finishedConcepts([conceptId]).has(conceptId)).toBe(false);
    expect(untestedConcepts([conceptId]).has(conceptId)).toBe(true);
  });

  it("does not offer a tests-only pass for a module with no body", () => {
    // Nothing to write questions from: this one has to be generated properly.
    addModule(conceptId, null);
    expect(untestedConcepts([conceptId]).has(conceptId)).toBe(false);
  });

  it("ignores concepts from another course", () => {
    addModule(conceptId, "## Body");
    const other = seedCourse();
    addModule(other.conceptId, "## Other");
    expect([...untestedConcepts([conceptId]).keys()]).toEqual([conceptId]);
    expect(courseId).not.toBe(other.courseId);
  });

  it("is empty for an empty list rather than scanning every module", () => {
    addModule(conceptId, "## Body");
    expect(untestedConcepts([]).size).toBe(0);
  });
});
