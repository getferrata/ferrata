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

export function estimateCostUsd(
  provider: ProviderName,
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  if (provider === "ollama") return 0;
  const p = PRICES[model] ?? UNKNOWN_MODEL_PRICE;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
