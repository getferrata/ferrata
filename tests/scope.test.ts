import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { intakeSchema } from "@/lib/llm/tasks/intake/schema";
import { providerHealth } from "@/lib/llm/health";

const valid = {
  title: "Rilascio in produzione",
  lang: "it",
  objective: "arrivare a fare un rilascio senza chiedere aiuto",
  domain: "release engineering",
  startLevel: "sa usare git, non ha mai rilasciato",
  deadline: null,
  budgetMinutes: 480,
  concretenessRule: "dove sta e chi paga",
  candidateConcepts: [
    { title: "a", summary: "s", priority: "high", estimatedMinutes: 30, depthLevel: 1 },
    { title: "b", summary: "s", priority: "high", estimatedMinutes: 30, depthLevel: 1 },
    { title: "c", summary: "s", priority: "high", estimatedMinutes: 30, depthLevel: 1 },
  ],
};

describe("intake declares what it left out", () => {
  it("accepts the list and keeps the reasons", () => {
    const parsed = intakeSchema.parse({
      ...valid,
      outOfScope: [
        {
          title: "Appendice B: riconciliazione PSP",
          reason: "la gestisce Finance, non tocca il rilascio",
        },
      ],
    });
    expect(parsed.outOfScope).toHaveLength(1);
    expect(parsed.outOfScope![0]!.reason).toContain("Finance");
  });

  it("does not cost a retry when a model omits the key", () => {
    // The field was added after the first courses were built; an older prompt
    // or a terse model dropping it should normalise, not fail and re-bill.
    expect(intakeSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an entry with no reason, which would be a bare disclaimer", () => {
    const bad = intakeSchema.safeParse({
      ...valid,
      outOfScope: [{ title: "Appendice B", reason: "" }],
    });
    expect(bad.success).toBe(false);
  });

  it("is written into cuts, or the student is never told", () => {
    // The handler is the only place this can happen, and a silent drop here is
    // exactly the bug: the concepts were stored and the leftovers were not.
    const src = readFileSync(
      join(process.cwd(), "src/lib/jobs/handlers.ts"),
      "utf8",
    );
    expect(src).toMatch(/for \(const s of result\.outOfScope \?\? \[\]\)/);
  });

  it("records a concept the author unchecked, instead of deleting it quietly", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/courses/[id]/concepts/route.ts"),
      "utf8",
    );
    expect(src).toContain("tx.insert(cuts)");
    // …and does not resume a paid pipeline for a non-examiner.
    expect(src).toContain('user.role !== "examiner"');
  });
});

describe("the settings banner reports readiness, not just a plan", () => {
  const clear = (): void => {
    for (const k of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GROQ_API_KEY",
      "OLLAMA_BASE_URL",
    ]) {
      delete process.env[k];
    }
  };

  it("is ready when the chosen provider has its key", async () => {
    clear();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await expect(
      providerHealth("anthropic", "claude-sonnet-5"),
    ).resolves.toEqual({ ok: true });
    clear();
  });

  it("says so when the key is missing rather than naming a model", async () => {
    clear();
    const h = await providerHealth("anthropic", "claude-sonnet-5");
    expect(h.ok).toBe(false);
    expect(h.ok === false && h.reason).toMatch(/no Anthropic key/);
  });

  it("does not call a local fallback ready when nothing answers there", async () => {
    // The old banner announced ollama · qwen2.5:14b-instruct on an install with
    // no keys and no Ollama, which read as "set up" and failed on first call.
    clear();
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
    const h = await providerHealth("ollama", "qwen2.5:14b-instruct");
    expect(h.ok).toBe(false);
    expect(h.ok === false && h.reason).toMatch(/nothing answers/);
    clear();
  });
});
