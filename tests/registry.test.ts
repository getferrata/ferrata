import { describe, expect, it } from "vitest";
import { planTask } from "@/lib/llm/registry";

describe("planTask provider/model resolution", () => {
  it("defaults to local Ollama when nothing is configured", () => {
    const p = planTask("write_module", {});
    expect(p.providerName).toBe("ollama");
    expect(p.tier).toBe("heavy");
    expect(p.model).toContain("qwen");
  });

  it("uses a Groq key via the OpenAI-compatible slot with Groq model defaults", () => {
    const e = { GROQ_API_KEY: "gsk_test" };
    const heavy = planTask("write_module", e);
    expect(heavy.providerName).toBe("openai");
    expect(heavy.model).toBe("llama-3.3-70b-versatile");
    const light = planTask("glossary", e); // glossary is a genuinely light task
    expect(light.providerName).toBe("openai");
    expect(light.model).toBe("llama-3.1-8b-instant");
  });

  it("does not use Groq defaults when a real OpenAI key is present", () => {
    const e = { OPENAI_API_KEY: "sk_test" };
    expect(planTask("write_module", e).model).toBe("gpt-4o");
    expect(planTask("glossary", e).model).toBe("gpt-4o-mini");
  });

  it("runs intake and the eval judge on the heavy tier (quality-critical)", () => {
    const e = { GROQ_API_KEY: "gsk_test" };
    expect(planTask("intake", e).tier).toBe("heavy");
    expect(planTask("eval_judge", e).tier).toBe("heavy");
    expect(planTask("interview_questions", e).tier).toBe("heavy");
  });

  it("lets explicit model env override the Groq defaults", () => {
    const e = { GROQ_API_KEY: "gsk_test", OPENAI_MODEL_HEAVY: "moonshotai/kimi-k2" };
    expect(planTask("write_module", e).model).toBe("moonshotai/kimi-k2");
  });

  it("prefers Anthropic for heavy tasks when its key is set", () => {
    const e = { ANTHROPIC_API_KEY: "sk-ant", GROQ_API_KEY: "gsk_test" };
    expect(planTask("write_module", e).providerName).toBe("anthropic");
    expect(planTask("write_module", e).model).toBe("claude-sonnet-5");
  });

  it("honors FERRATA_LLM_OVERRIDE", () => {
    const e = { ANTHROPIC_API_KEY: "sk-ant", FERRATA_LLM_OVERRIDE: "ollama" };
    expect(planTask("write_module", e).providerName).toBe("ollama");
  });
});

describe("a Groq key pasted into the OpenAI slot", () => {
  // Settings offers one field for every OpenAI-style provider, so this is how a
  // Groq key actually arrives. Before, it was sent to api.openai.com asking for
  // gpt-4o, and every call failed.
  it("picks Groq model ids", () => {
    const plan = planTask("write_module", {
      FERRATA_LLM_OVERRIDE: "openai",
      OPENAI_API_KEY: "gsk_abc123",
    });
    expect(plan.providerName).toBe("openai");
    expect(plan.model).toBe("llama-3.3-70b-versatile");
  });

  it("still picks OpenAI model ids for a real OpenAI key", () => {
    const plan = planTask("write_module", {
      FERRATA_LLM_OVERRIDE: "openai",
      OPENAI_API_KEY: "sk-proj-abc123",
    });
    expect(plan.model).toBe("gpt-4o");
  });

  it("lets an explicit model override win either way", () => {
    const plan = planTask("write_module", {
      FERRATA_LLM_OVERRIDE: "openai",
      OPENAI_API_KEY: "gsk_abc123",
      OPENAI_MODEL_HEAVY: "moonshotai/kimi-k2-instruct",
    });
    expect(plan.model).toBe("moonshotai/kimi-k2-instruct");
  });
});
