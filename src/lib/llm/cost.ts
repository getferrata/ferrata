import type { ProviderName } from "./registry";

/**
 * Approximate USD price per 1M tokens, used only to populate the llm_calls
 * ledger so the README can show expected cost. Hosted prices move; treat these
 * as order-of-magnitude. Local Ollama is zero.
 */
interface Price {
  in: number;
  out: number;
}

const PRICES: Record<string, Price> = {
  // Anthropic (approx.)
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-5": { in: 15, out: 75 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  // OpenAI (approx.)
  "gpt-5.6": { in: 5, out: 30 },
  "gpt-5.6-terra": { in: 2.5, out: 12 },
  "gpt-5.6-luna": { in: 0.5, out: 2 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  // Groq-hosted open models (approx.)
  "llama-3.3-70b-versatile": { in: 0.6, out: 0.8 },
  "llama-3.1-8b-instant": { in: 0.05, out: 0.08 },
};

/**
 * What an unlisted model is assumed to cost: the most expensive rate here.
 *
 * The settings page lists models pulled live from the provider, so a model this
 * table has never heard of is the normal case, not the exception. Pricing it at
 * zero made every call free in the ledger, which made `spentBy` sum to zero,
 * which made the credit ceiling never fire: a defence that believes it is armed
 * and is not, which is worse than no defence at all. Overestimating stops
 * generation early and says so; underestimating says nothing until the invoice.
 */
const UNKNOWN_MODEL_PRICE: Price = { in: 15, out: 75 };

/** Whether the ledger figure for this model is a real price or the fallback. */
export function isPriceKnown(provider: ProviderName, model: string): boolean {
  return provider === "ollama" || model in PRICES;
}

/**
 * What a cached input token costs, as a multiple of the normal input rate.
 *
 * A read is a tenth; a write is a quarter more than full price. The write
 * premium is why caching is not free to switch on: a prefix written once and
 * never read again costs more than not caching at all, which is exactly what
 * happens on a stage that runs once per course. It pays from the second call.
 */
const CACHE_READ_RATE = 0.1;
const CACHE_WRITE_RATE = 1.25;

export interface CacheTokens {
  readTokens: number;
  writeTokens: number;
}

export function estimateCostUsd(
  provider: ProviderName,
  model: string,
  tokensIn: number,
  tokensOut: number,
  /**
   * The cached share of `tokensIn`. Omitted where a provider does not report
   * one, in which case the whole prompt is priced at the full rate, which is
   * what it cost.
   */
  cache?: CacheTokens,
): number {
  if (provider === "ollama") return 0;
  const p = PRICES[model] ?? UNKNOWN_MODEL_PRICE;
  const read = Math.max(0, cache?.readTokens ?? 0);
  const written = Math.max(0, cache?.writeTokens ?? 0);
  // Clamped rather than trusted: tokensIn carries the cached spans, so a
  // provider reporting more cached than total would otherwise price a negative
  // number of tokens and hand back a discount that never happened.
  const full = Math.max(0, tokensIn - read - written);
  const inputUsd =
    full * p.in + written * p.in * CACHE_WRITE_RATE + read * p.in * CACHE_READ_RATE;
  return (inputUsd + tokensOut * p.out) / 1_000_000;
}
