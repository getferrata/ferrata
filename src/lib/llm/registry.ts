import { AnthropicProvider } from "./providers/anthropic";
import { OpenAICompatProvider } from "./providers/openai-compat";
import { OllamaProvider } from "./providers/ollama";
import { LlmConfigError, type LlmProvider } from "./provider";

/**
 * Per-task model selection: models are chosen per task, not globally.
 *
 *   - light  tasks (extraction, structuring): cheapest capable model
 *   - heavy  tasks (generative writing that must hit the quality bar): strong model
 *
 * Resolution order for a tier, given what is configured:
 *   FERRATA_LLM_OVERRIDE  ->  Anthropic (if key)  ->  OpenAI (if key)  ->  Ollama
 * With nothing configured, everything runs locally on Ollama and costs zero.
 */

export type Tier = "light" | "heavy";
export type ProviderName = "anthropic" | "openai" | "ollama";

export type TaskName =
  | "interview_questions"
  | "intake"
  | "build_graph"
  | "triage"
  | "write_module"
  | "concreteness_pass"
  | "write_questions"
  | "schedule"
  | "glossary"
  | "eval_judge"
  | "feynman";

const TASK_TIER: Record<TaskName, Tier> = {
  // Context-critical judgment + the quality gate MUST use the strong model:
  // intake conceives the course (what to cover, what to CUT), and a weak judge
  // rubber-stamps filler. Tiering these "light" was the main cause of generic
  // output on smaller models.
  interview_questions: "heavy",
  intake: "heavy",
  build_graph: "heavy",
  eval_judge: "heavy",
  write_module: "heavy",
  concreteness_pass: "heavy",
  write_questions: "heavy",
  // Genuinely mechanical / low-stakes: cheap model is fine.
  triage: "light",
  schedule: "light",
  glossary: "light",
  feynman: "light",
};

interface Resolved {
  provider: LlmProvider;
  providerName: ProviderName;
  model: string;
  tier: Tier;
}

type Env = Record<string, string | undefined>;

function readEnv(e: Env, name: string, fallback: string): string {
  const v = e[name];
  return v && v.trim() ? v.trim() : fallback;
}

/** True when the OpenAI-compatible slot is being driven by a Groq key alone. */
function isGroq(e: Env): boolean {
  return !e.OPENAI_API_KEY && Boolean(e.GROQ_API_KEY);
}

/** Model id for a (provider, tier) pair. All overridable by env. */
function modelFor(provider: ProviderName, tier: Tier, e: Env): string {
  if (provider === "anthropic") {
    return tier === "heavy"
      ? readEnv(e, "ANTHROPIC_MODEL_HEAVY", "claude-sonnet-5")
      : readEnv(e, "ANTHROPIC_MODEL_LIGHT", "claude-haiku-4-5-20251001");
  }
  if (provider === "openai") {
    // Groq uses different model ids; pick sensible Groq defaults so a bare
    // GROQ_API_KEY works with no further config. OPENAI_MODEL_* still overrides.
    if (isGroq(e)) {
      return tier === "heavy"
        ? readEnv(e, "OPENAI_MODEL_HEAVY", "llama-3.3-70b-versatile")
        : readEnv(e, "OPENAI_MODEL_LIGHT", "llama-3.1-8b-instant");
    }
    return tier === "heavy"
      ? readEnv(e, "OPENAI_MODEL_HEAVY", "gpt-4o")
      : readEnv(e, "OPENAI_MODEL_LIGHT", "gpt-4o-mini");
  }
  return tier === "heavy"
    ? readEnv(e, "OLLAMA_MODEL_HEAVY", "qwen2.5:14b-instruct")
    : readEnv(e, "OLLAMA_MODEL_LIGHT", "qwen2.5:7b-instruct");
}

function makeProvider(name: ProviderName): LlmProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
      return new OpenAICompatProvider();
    case "ollama":
      return new OllamaProvider();
  }
}

function hasKey(name: ProviderName, e: Env): boolean {
  if (name === "anthropic") return Boolean(e.ANTHROPIC_API_KEY);
  if (name === "openai")
    return Boolean(e.OPENAI_API_KEY || e.GROQ_API_KEY);
  return true; // Ollama needs no key; assumed reachable locally.
}

function pickProviderName(tier: Tier, e: Env): ProviderName {
  const override = e.FERRATA_LLM_OVERRIDE?.trim() as ProviderName | undefined;
  if (override && ["anthropic", "openai", "ollama"].includes(override)) {
    return override;
  }
  // Heavy prefers the strongest available; light prefers the cheapest hosted,
  // else whatever is there, else local.
  const order: ProviderName[] =
    tier === "heavy"
      ? ["anthropic", "openai", "ollama"]
      : ["openai", "anthropic", "ollama"];
  return order.find((n) => hasKey(n, e)) ?? "ollama";
}

export interface TaskPlan {
  providerName: ProviderName;
  model: string;
  tier: Tier;
}

/**
 * Pure resolution of which provider + model a task uses, given an env snapshot.
 * Side-effect free (constructs nothing), so it is unit-testable; resolveTask
 * builds on it. Defaults to process.env.
 */
export function planTask(task: TaskName, e: Env = process.env): TaskPlan {
  const tier = TASK_TIER[task];
  const providerName = pickProviderName(tier, e);
  return { providerName, model: modelFor(providerName, tier, e), tier };
}

// Providers are cheap to construct but validate config in their ctor; cache
// successfully-built ones so a missing key is only probed once per process.
const cache = new Map<ProviderName, LlmProvider>();

/** Drop cached providers so changed keys/base URLs take effect immediately. */
export function clearProviderCache(): void {
  cache.clear();
}

export function resolveTask(task: TaskName): Resolved {
  const plan = planTask(task);
  let provider = cache.get(plan.providerName);
  if (!provider) {
    try {
      provider = makeProvider(plan.providerName);
    } catch (err) {
      if (err instanceof LlmConfigError && plan.providerName !== "ollama") {
        // Configured preference lost its key mid-run; fall back to local.
        provider = makeProvider("ollama");
        return {
          provider,
          providerName: "ollama",
          model: modelFor("ollama", plan.tier, process.env),
          tier: plan.tier,
        };
      }
      throw err;
    }
    cache.set(plan.providerName, provider);
  }
  return {
    provider,
    providerName: plan.providerName,
    model: plan.model,
    tier: plan.tier,
  };
}
