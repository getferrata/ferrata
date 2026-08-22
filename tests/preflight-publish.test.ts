import { describe, expect, it } from "vitest";
import {
  MARKDOWN_HEADER,
  publishableReason,
  toCompatibilityRow,
  toMarkdownRow,
} from "@/lib/llm/preflight/publish";
import type { PreflightReport, StageReport } from "@/lib/llm/preflight/report";

/**
 * A published row is a claim about somebody else's model, made from a run on
 * somebody's own machine and their own key. These tests are about the two ways
 * that goes wrong: carrying out something that belongs to the operator, and
 * carrying numbers with nothing to date them.
 */

function stage(over: Partial<StageReport> = {}): StageReport {
  return {
    task: "write_module",
    ok: true,
    calls: 1,
    wasted: 0,
    tokensIn: 100,
    tokensOut: 200,
    costUsd: 0.001,
    hitCap: false,
    cap: 4000,
    reasons: [],
    ...over,
  };
}

function report(over: Partial<PreflightReport> = {}): PreflightReport {
  return {
    stages: [stage()],
    totalUsd: 0.004,
    totalCalls: 8,
    wastedCalls: 0,
    wastedUsd: 0,
    verdict: "clean",
    missing: [],
    errors: [],
    ...over,
  };
}

describe("what a published row carries", () => {
  it("has the model, the numbers and the version, and no identifiers", () => {
    const row = toCompatibilityRow(report(), "llama-3.3-70b-versatile", "openai");
    expect(row.model).toBe("llama-3.3-70b-versatile");
    expect(row.totalUsd).toBe(0.004);
    expect(row.ferrataVersion).toMatch(/^\d+\.\d+\.\d+/);
    // Nothing anywhere that could name the install, the operator or the run.
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/preflight_|course_|user_|llm_/);
  });

  it("counts a stage that never ran as attempted, not as absent", () => {
    // A model that could not produce a single call for a stage is the worst
    // outcome there is. Leaving it out of the denominator would print 1/1.
    const row = toCompatibilityRow(
      report({ missing: ["write_questions", "glossary"] }),
      "m",
      "ollama",
    );
    expect(row.stagesTotal).toBe(3);
    expect(row.stagesOk).toBe(1);
    expect(row.missing).toEqual(["write_questions", "glossary"]);
  });

  it("keeps a validation reason, which is the useful half", () => {
    // What another operator needs: the field the model kept getting wrong.
    expect(publishableReason("schema: questions.0.bloomLevel: Expected string")).toBe(
      "questions.0.bloomLevel: Expected string",
    );
  });

  it("throws away a transport reason, which is the operator's network", () => {
    // These quote hostnames, ports, and on a bad day a fragment of a key.
    const out = publishableReason(
      "transport: Ollama unreachable at http://10.1.2.3:11434 (token sk-abc)",
    );
    expect(out).toBe("the call itself failed");
    expect(out).not.toContain("10.1.2.3");
    expect(out).not.toContain("sk-");
  });

  it("summarises a reason whose shape it does not recognise", () => {
    // The unrecognised string is the one most likely to carry something local,
    // so the default is to say nothing specific rather than to pass it through.
    expect(publishableReason("weird local detail /home/denis/ferrata.db")).not.toContain(
      "/home/",
    );
  });

  it("says truncation plainly, since it is about the ceiling and not the machine", () => {
    expect(publishableReason("truncated at the 4000-token cap")).toContain("4000");
  });

  it("deduplicates the reasons across stages", () => {
    const row = toCompatibilityRow(
      report({
        stages: [
          stage({ reasons: ["schema: a.b: Required"] }),
          stage({ task: "write_questions", reasons: ["schema: a.b: Required"] }),
        ],
      }),
      "m",
      "ollama",
    );
    expect(row.reasons).toEqual(["a.b: Required"]);
  });
});

describe("the table it prints", () => {
  it("renders a row that lines up with the header", () => {
    const row = toMarkdownRow(
      toCompatibilityRow(report(), "claude-sonnet-5", "anthropic"),
    );
    const columns = (s: string) => s.split("|").length;
    expect(columns(row)).toBe(columns(MARKDOWN_HEADER.split("\n")[0]!));
    expect(row).toContain("claude-sonnet-5");
    expect(row).toContain("$0.0040");
  });

  it("says free rather than $0.00 for a local model", () => {
    // Zero dollars on a hosted model would mean the price table is missing the
    // name, which is a different thing entirely and must not read the same.
    const row = toMarkdownRow(
      toCompatibilityRow(report({ totalUsd: 0 }), "qwen2.5:7b", "ollama"),
    );
    expect(row).toContain("free");
  });
});
