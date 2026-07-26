import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-settings-")),
  "test.db",
);

const {
  LLM_SETTING_KEYS,
  applyLlmSettings,
  getSetting,
  isLlmSettingKey,
  maskSecret,
  readLlmSettings,
  setSetting,
} = await import("@/lib/settings");

describe("maskSecret", () => {
  it("keeps only the last 4 chars", () => {
    expect(maskSecret("sk-ant-abc123xyz9")).toBe("…xyz9");
  });
  it("passes through empty values as null", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("")).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
  });
});

describe("isLlmSettingKey", () => {
  it("accepts every allowlisted key", () => {
    for (const k of LLM_SETTING_KEYS) expect(isLlmSettingKey(k)).toBe(true);
  });
  it("rejects arbitrary keys (no env injection through the API)", () => {
    expect(isLlmSettingKey("PATH")).toBe(false);
    expect(isLlmSettingKey("NODE_OPTIONS")).toBe(false);
    expect(isLlmSettingKey("ANTHROPIC_API_KEY2")).toBe(false);
  });
});

describe("set/get/read settings", () => {
  it("round-trips a value", () => {
    setSetting("ANTHROPIC_API_KEY", "sk-test-1234");
    expect(getSetting("ANTHROPIC_API_KEY")).toBe("sk-test-1234");
  });

  it("trims and upserts", () => {
    setSetting("OLLAMA_BASE_URL", "  http://10.0.0.5:11434  ");
    expect(getSetting("OLLAMA_BASE_URL")).toBe("http://10.0.0.5:11434");
    setSetting("OLLAMA_BASE_URL", "http://10.0.0.6:11434");
    expect(getSetting("OLLAMA_BASE_URL")).toBe("http://10.0.0.6:11434");
  });

  it("deletes on null or empty", () => {
    setSetting("OPENAI_API_KEY", "sk-x");
    setSetting("OPENAI_API_KEY", null);
    expect(getSetting("OPENAI_API_KEY")).toBeNull();
    setSetting("OPENAI_API_KEY", "sk-y");
    setSetting("OPENAI_API_KEY", "   ");
    expect(getSetting("OPENAI_API_KEY")).toBeNull();
  });

  it("readLlmSettings only returns allowlisted keys", () => {
    setSetting("random_key", "boo");
    const all = readLlmSettings();
    expect(Object.keys(all)).not.toContain("random_key");
    expect(all.ANTHROPIC_API_KEY).toBe("sk-test-1234");
  });
});

describe("applyLlmSettings", () => {
  it("applies stored values over process.env", () => {
    process.env.ANTHROPIC_MODEL_HEAVY = "from-env";
    setSetting("ANTHROPIC_MODEL_HEAVY", "from-db");
    applyLlmSettings();
    expect(process.env.ANTHROPIC_MODEL_HEAVY).toBe("from-db");
  });

  it("leaves real env vars alone when no row exists", () => {
    process.env.OPENAI_MODEL_LIGHT = "env-only";
    applyLlmSettings();
    expect(process.env.OPENAI_MODEL_LIGHT).toBe("env-only");
  });
});

describe("model list merging", () => {
  it("prettifies raw ids", async () => {
    const { prettifyModelId } = await import("@/lib/llm/modelslist");
    expect(prettifyModelId("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(prettifyModelId("qwen2.5:7b-instruct")).toBe("Qwen2.5 7b Instruct");
  });

  it("keeps curated labels and appends unknown live models", async () => {
    const { mergeModels } = await import("@/lib/llm/modelslist");
    const merged = mergeModels("anthropic", [
      "claude-sonnet-5",
      "claude-brand-new-6",
    ]);
    const sonnet = merged.find((m) => m.id === "claude-sonnet-5");
    expect(sonnet?.label).toBe("Claude Sonnet 5");
    expect(sonnet?.hint).toBe("recommended");
    const fresh = merged.find((m) => m.id === "claude-brand-new-6");
    expect(fresh?.label).toBe("Claude Brand New 6");
    // curated model NOT in the live list is dropped (account can't use it)
    expect(merged.some((m) => m.id === "claude-opus-5")).toBe(false);
  });

  it("falls back to the full curated catalog when no live list", async () => {
    const { mergeModels } = await import("@/lib/llm/modelslist");
    const merged = mergeModels("ollama", []);
    expect(merged.length).toBeGreaterThan(2);
    expect(merged.every((m) => m.label.length > 0)).toBe(true);
  });
});

describe("applyLlmSettings: delete restores the real environment", () => {
  it("removing a stored key unsets the env var we set", () => {
    delete process.env.GROQ_API_KEY;
    setSetting("GROQ_API_KEY", "gsk_temp");
    applyLlmSettings();
    expect(process.env.GROQ_API_KEY).toBe("gsk_temp");
    setSetting("GROQ_API_KEY", null);
    applyLlmSettings();
    expect(process.env.GROQ_API_KEY).toBeUndefined();
  });

  it("removing a stored key falls back to the original env value", () => {
    process.env.OLLAMA_MODEL_LIGHT = "real-env-model";
    setSetting("OLLAMA_MODEL_LIGHT", "db-model");
    applyLlmSettings();
    expect(process.env.OLLAMA_MODEL_LIGHT).toBe("db-model");
    setSetting("OLLAMA_MODEL_LIGHT", null);
    applyLlmSettings();
    expect(process.env.OLLAMA_MODEL_LIGHT).toBe("real-env-model");
  });
});
