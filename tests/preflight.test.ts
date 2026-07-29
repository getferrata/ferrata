import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { llmCalls } from "@/db/schema";
import { buildReport } from "@/lib/llm/preflight/report";
import { PREFLIGHT_STAGES, preflightTag } from "@/lib/llm/preflight";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { courseSpend, measuredPerModuleUsd } from "@/lib/llm/spend";
import { newId } from "@/lib/util/id";

let tag: string;

function call(
  task: string,
  opts: {
    ok: boolean;
    tokensOut?: number;
    costUsd?: number;
    error?: string;
  } = { ok: true },
): void {
  db.insert(llmCalls)
    .values({
      id: newId("llm"),
      courseId: tag,
      userId: null,
      task,
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 100,
      tokensOut: opts.tokensOut ?? 200,
      costUsd: opts.costUsd ?? 0.01,
      credits: 1,
      latencyMs: 10,
      ok: opts.ok,
      priceKnown: true,
      error: opts.ok ? null : (opts.error ?? null),
    })
    .run();
}

describe("preflight report", () => {
  beforeEach(() => {
    tag = preflightTag(newId("pf"));
  });

  it("calls a run clean when every stage answered once", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    const report = buildReport(tag, [...PREFLIGHT_STAGES]);
    expect(report.verdict).toBe("clean");
    expect(report.wastedCalls).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.stages).toHaveLength(PREFLIGHT_STAGES.length);
  });

  it("calls it wasteful when a stage was billed twice for one answer", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    call("concreteness_pass", { ok: false, costUsd: 0.05 });
    const report = buildReport(tag, [...PREFLIGHT_STAGES]);
    expect(report.verdict).toBe("wasteful");
    expect(report.wastedCalls).toBe(1);
    expect(report.wastedUsd).toBeCloseTo(0.05, 5);
    const stage = report.stages.find((s) => s.task === "concreteness_pass");
    expect(stage).toMatchObject({ ok: true, calls: 2, wasted: 1 });
  });

  it("flags a stage that answered right up against its ceiling", () => {
    // The signature of a ceiling set too low: the answer stops exactly where it
    // was allowed to, which is what turns into a second billed call.
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    call("eval_judge", { ok: true, tokensOut: OUTPUT_CAPS.eval_judge });
    const report = buildReport(tag, [...PREFLIGHT_STAGES]);
    expect(report.stages.find((s) => s.task === "eval_judge")?.hitCap).toBe(true);
    expect(report.verdict).toBe("wasteful");
  });

  it("calls it broken when a stage never managed a single call", () => {
    // The worst outcome leaves no ledger row at all, so a report built only
    // from rows would show it as an empty space rather than a failure.
    for (const task of PREFLIGHT_STAGES) {
      if (task !== "glossary") call(task, { ok: true });
    }
    const report = buildReport(tag, [...PREFLIGHT_STAGES]);
    expect(report.verdict).toBe("broken");
    expect(report.missing).toEqual(["glossary"]);
  });

  it("calls it broken when every attempt at a stage was discarded", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    // A stage with rows but no successful one: billed, and nothing to show.
    db.delete(llmCalls).run();
    for (const task of PREFLIGHT_STAGES) {
      call(task, { ok: task !== "write_module" });
    }
    const report = buildReport(tag, [...PREFLIGHT_STAGES]);
    expect(report.verdict).toBe("broken");
    expect(report.stages.find((s) => s.task === "write_module")?.ok).toBe(false);
  });

  it("counts only its own run, never another's", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    const other = tag;
    tag = preflightTag(newId("pf"));
    for (const task of PREFLIGHT_STAGES) call(task, { ok: false });
    const report = buildReport(other, [...PREFLIGHT_STAGES]);
    expect(report.verdict).toBe("clean");
    expect(report.totalCalls).toBe(PREFLIGHT_STAGES.length);
  });

  it("carries a thrown stage's message through to the report", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    const report = buildReport(tag, [...PREFLIGHT_STAGES], [
      { task: "glossary", message: "model refused the format" },
    ]);
    expect(report.errors[0]?.message).toBe("model refused the format");
  });

  it("says why a call was discarded, not just that it was", () => {
    // A count tells an operator to change something without telling them what.
    // A rule rejecting a good answer and a ceiling set too low look identical
    // on the bill and need opposite fixes.
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    call("write_questions", {
      ok: false,
      error: "schema: questions.0.misconceptions: Required",
    });
    const stage = buildReport(tag, [...PREFLIGHT_STAGES]).stages.find(
      (s) => s.task === "write_questions",
    );
    expect(stage?.reasons).toEqual(["schema: questions.0.misconceptions: Required"]);
  });

  it("does not repeat the same reason once per discarded call", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    for (let i = 0; i < 3; i++) {
      call("eval_judge", { ok: false, error: "truncated at the 4000-token cap" });
    }
    const stage = buildReport(tag, [...PREFLIGHT_STAGES]).stages.find(
      (s) => s.task === "eval_judge",
    );
    expect(stage?.wasted).toBe(3);
    expect(stage?.reasons).toHaveLength(1);
  });

  it("leaves the reasons empty for a stage that wasted nothing", () => {
    for (const task of PREFLIGHT_STAGES) call(task, { ok: true });
    for (const stage of buildReport(tag, [...PREFLIGHT_STAGES]).stages) {
      expect(stage.reasons).toEqual([]);
    }
  });

  it("never lands in a course receipt or in the measured per-module average", () => {
    // llm_calls.courseId is what course spend and the measured average read.
    // A preflight writes write_module rows like any course does, so if the tag
    // were mistaken for a course id it would quietly move the price the
    // product quotes, using a fixture nobody is studying.
    expect(preflightTag("pf_1")).toMatch(/^preflight_/);
    for (let i = 0; i < 10; i++) call("write_module", { ok: true, costUsd: 9 });
    expect(courseSpend(tag)?.calls).toBe(10);
    expect(measuredPerModuleUsd("claude-sonnet-5")).toBeNull();
  });
});
