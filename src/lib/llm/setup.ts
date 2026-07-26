import { planTask } from "./registry";
import { estimateCourseCost, type CourseCostEstimate } from "./estimate";
import { measuredPerModuleUsd } from "./spend";

/**
 * "Is generation going to work?" for the first-run experience. Stored settings
 * are already applied over process.env at boot and on save, so the env snapshot
 * is the single source of truth here.
 */

export type SetupReason = "key" | "local-explicit" | "local-running" | null;

export function setupReason(
  e: Record<string, string | undefined>,
  ollamaReachable: boolean,
): SetupReason {
  if (e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GROQ_API_KEY) return "key";
  if (e.FERRATA_LLM_OVERRIDE?.trim() === "ollama") return "local-explicit";
  if (ollamaReachable) return "local-running";
  return null;
}

// The local-server probe is on the page path, so keep it fast and cache it.
const PROBE_TIMEOUT_MS = 1_500;
const PROBE_TTL_MS = 60_000;
let probeCache: { at: number; ok: boolean } | null = null;

export async function ollamaReachable(): Promise<boolean> {
  const now = Date.now();
  if (probeCache && now - probeCache.at < PROBE_TTL_MS) return probeCache.ok;
  const base = (
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    ok = res.ok;
  } catch {
    ok = false;
  }
  probeCache = { at: now, ok };
  return ok;
}

export interface SetupStatus {
  configured: boolean;
  reason: SetupReason;
  active: { provider: string; model: string };
  cost: CourseCostEstimate;
}

export async function llmSetupStatus(): Promise<SetupStatus> {
  const reachable = await ollamaReachable();
  const reason = setupReason(process.env, reachable);
  const plan = planTask("write_module");
  return {
    configured: reason !== null,
    reason,
    active: { provider: plan.providerName, model: plan.model },
    cost: estimateCourseCost(
      plan.providerName,
      plan.model,
      measuredPerModuleUsd(),
    ),
  };
}
