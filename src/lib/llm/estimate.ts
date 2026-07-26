import type { ProviderName } from "./registry";
import { estimateCostUsd } from "./cost";

/**
 * Rough per-course token profile, shown before building so the decision is
 * informed. Never billed, and never precise.
 *
 * A module is not one call. Each one is written, put through a separate
 * concreteness pass, judged, and given its tests, and the first three repeat
 * when the judge is not satisfied: four to eight calls, not one. The earlier
 * figures here were a single write and came out about three times under, on the
 * number the product uses as its headline promise.
 *
 * These constants are the fallback for a fresh install with no history. Once an
 * install has finished a few courses the estimate uses its own measured average
 * instead, which reflects the model and the depth actually in use.
 */
const BASE_TOKENS = { in: 12_000, out: 3_000 };
const PER_MODULE_TOKENS = { in: 34_000, out: 12_000 };

export interface CourseCostEstimate {
  baseUsd: number;
  perModuleUsd: number;
  /** True when the per-module figure comes from this install's own runs. */
  measured: boolean;
}

export function estimateCourseCost(
  provider: ProviderName,
  model: string,
  /** This install's own measured cost per module, when it has enough history. */
  measuredPerModuleUsd?: number | null,
): CourseCostEstimate {
  return {
    baseUsd: estimateCostUsd(provider, model, BASE_TOKENS.in, BASE_TOKENS.out),
    perModuleUsd:
      measuredPerModuleUsd && measuredPerModuleUsd > 0
        ? measuredPerModuleUsd
        : estimateCostUsd(
            provider,
            model,
            PER_MODULE_TOKENS.in,
            PER_MODULE_TOKENS.out,
          ),
    measured: Boolean(measuredPerModuleUsd && measuredPerModuleUsd > 0),
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
