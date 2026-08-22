import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  modules as modulesT,
  questions as questionsT,
  type CourseStatus,
  type ModuleKind,
  type ModuleStatus,
} from "@/db/schema";
import { courseGaps, isComplete } from "@/lib/course/gaps";
import { newId, now } from "@/lib/util/id";

/**
 * The two states a finished course can be in without saying so, both produced
 * for real by local benchmark runs: a module that shipped with no test because
 * write_questions failed twice, and a concept with no module because
 * generate_course caught the error and carried on with the rest.
 */

function clean(): void {
  db.delete(questionsT).run();
  db.delete(modulesT).run();
  db.delete(conceptsT).run();
  db.delete(coursesT).run();
}

function course(status: CourseStatus = "ready"): string {
  const id = newId("course");
  db.insert(coursesT)
    .values({ id, title: "C", sourcePrompt: "b", lang: "en", status })
    .run();
  return id;
}

function concept(courseId: string, title: string, order = 0): string {
  const id = newId("concept");
  db.insert(conceptsT)
    .values({ id, courseId, title, summary: "s", topoOrder: order })
    .run();
  return id;
}

function moduleFor(
  conceptId: string,
  kind: ModuleKind = "concept",
  status: ModuleStatus = "ready",
): string {
  const id = newId("module");
  db.insert(modulesT)
    .values({ id, conceptId, kind, bodyMd: "# body", status, generatedAt: now() })
    .run();
  return id;
}

function questionFor(conceptId: string): void {
  db.insert(questionsT)
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

describe("what a finished course is missing", () => {
  beforeEach(clean);

  it("says nothing about a course that is actually complete", () => {
    const c = course();
    const k = concept(c, "Edge gateway");
    moduleFor(k);
    questionFor(k);
    const gaps = courseGaps(c);
    expect(isComplete(gaps)).toBe(true);
  });

  it("names the module that shipped with no test", () => {
    const c = course();
    const good = concept(c, "Edge gateway", 0);
    moduleFor(good);
    questionFor(good);
    const bare = concept(c, "Reading a 503", 1);
    const bareModule = moduleFor(bare);

    const gaps = courseGaps(c);
    expect(gaps.untested).toEqual([
      { conceptId: bare, moduleId: bareModule, title: "Reading a 503" },
    ]);
    expect(gaps.missing).toEqual([]);
  });

  it("names the concept nobody wrote a module for", () => {
    const c = course();
    const done = concept(c, "Edge gateway", 0);
    moduleFor(done);
    questionFor(done);
    const skipped = concept(c, "Postgres failover", 1);

    const gaps = courseGaps(c);
    expect(gaps.missing).toEqual([
      { conceptId: skipped, title: "Postgres failover" },
    ]);
    expect(gaps.untested).toEqual([]);
  });

  it("counts a module still being written as missing, not as untested", () => {
    // A body that exists but is not ready is a build in progress, not a hole,
    // and reporting it as a module with no test would name the wrong problem.
    const c = course();
    const k = concept(c, "Failover");
    moduleFor(k, "concept", "pending");
    const gaps = courseGaps(c);
    expect(gaps.missing.map((g) => g.title)).toEqual(["Failover"]);
    expect(gaps.untested).toEqual([]);
  });

  it("ignores a retired concept, which is a cut and not a gap", () => {
    const c = course();
    const k = concept(c, "Dropped");
    db.update(conceptsT)
      .set({ retiredAt: now() })
      .where(eq(conceptsT.id, k))
      .run();
    expect(isComplete(courseGaps(c))).toBe(true);
  });

  it("ignores a retired question, which leaves its module untested again", () => {
    // The state after a module is rewritten: old questions retired, new ones
    // not yet written. A reader meeting it now has nothing to answer.
    const c = course();
    const k = concept(c, "Edge gateway");
    const m = moduleFor(k);
    db.insert(questionsT)
      .values({
        id: newId("q"),
        conceptId: k,
        prompt: "p",
        expectedAnswer: "a",
        bloomLevel: "understand",
        format: "open",
        retiredAt: now(),
      })
      .run();
    expect(courseGaps(c).untested).toEqual([
      { conceptId: k, moduleId: m, title: "Edge gateway" },
    ]);
  });

  it("does not ask a method module for a test", () => {
    // The reference course ends with two of these, how to troubleshoot and how
    // the interview goes, and neither is measurable with a question about a
    // fact. Nothing writes this kind yet; the rule is here so that when
    // something does, it is not reported as broken for being what it is.
    const c = course();
    const k = concept(c, "How to troubleshoot");
    moduleFor(k, "method");
    expect(isComplete(courseGaps(c))).toBe(true);
  });

  it("keeps one course's holes out of another's report", () => {
    const mine = course();
    const k = concept(mine, "Mine");
    moduleFor(k);
    questionFor(k);
    const other = course();
    concept(other, "Theirs");
    expect(isComplete(courseGaps(mine))).toBe(true);
    expect(courseGaps(other).missing).toHaveLength(1);
  });
});
