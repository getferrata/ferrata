import type { ProviderName } from "./registry";
import { estimateCostUsd } from "./cost";

/**
 * Rough per-course token profile, measured from real generation runs on the
 * benchmark KB (intake + graph overhead, then per-module writing, tests and
 * evaluation). Order-of-magnitude on purpose; shown to the author before they
 * build so the decision is informed, never billed.
 */
const BASE_TOKENS = { in: 8_000, out: 2_000 };
const PER_MODULE_TOKENS = { in: 9_000, out: 3_500 };

export interface CourseCostEstimate {
  baseUsd: number;
  perModuleUsd: number;
}

export function estimateCourseCost(
  provider: ProviderName,
  model: string,
): CourseCostEstimate {
  return {
    baseUsd: estimateCostUsd(provider, model, BASE_TOKENS.in, BASE_TOKENS.out),
    perModuleUsd: estimateCostUsd(
      provider,
      model,
      PER_MODULE_TOKENS.in,
      PER_MODULE_TOKENS.out,
    ),
  };
}

export function courseCostUsd(
  est: CourseCostEstimate,
  moduleCount: number,
): number {
  return est.baseUsd + est.perModuleUsd * Math.max(0, moduleCount);
}

/** "$0.42", "$2.10", or "free" for local. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "free";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
