import type { ProviderName } from "./registry";
import { estimateCostUsd } from "./cost";

/**
 * Rough per-course token profile, shown before building so the decision is
 * informed. Never billed, and never precise.
 *
 * A module is not one call. Each one is written, put through a separate
 * concreteness pass, judged, and given its tests: four calls at least, and the
 * whole group repeats when the judge is not satisfied.
 *
 * The figures below come from a finished course against a hosted model, over a
 * repository of 131 files: fourteen modules, and every stage of the pipeline
 * including the two that only run at the end.
 *
 * They count **only the calls that were kept**. Two thirds of what that run
 * billed went on calls that were discarded, and pricing a course as if that
 * still happened would quote the bill of a bug that has been fixed. On the same
 * arithmetic, a mid-run reading taken while the waste was still in the numbers
 * put this 20 per cent too high.
 *
 * What they are not:
 *
 * - Exact for the pipeline as it stands now. That run gave a single test to
 *   every deep module because the test writer kept running past its ceiling, so
 *   the questions those modules should have had are not in this figure; against
 *   that, the concreteness pass no longer pays a JSON escaping tax. The two
 *   roughly cancel, and the next finished course is what settles it.
 * - A promise for a different shape of course. The grounding excerpts ride in
 *   every module call, so a course built from a brief alone costs materially
 *   less than one built from a repository, and this is the expensive side.
 *
 * They are the fallback for a fresh install with no history. Once an install has
 * finished a few courses the estimate uses its own measured average instead,
 * which reflects the model, the depth and the kind of material actually in use.
 */
const BASE_TOKENS = { in: 12_000, out: 10_000 };
const PER_MODULE_TOKENS = { in: 34_000, out: 13_000 };

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
