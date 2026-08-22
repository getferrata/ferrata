/**
 * Provider-agnostic LLM contract. One narrow
 * interface; concrete providers for Anthropic, any OpenAI-compatible endpoint,
 * and local Ollama live in ./providers. The model is chosen per task by the
 * registry, never globally.
 */

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/**
 * A system prompt split at the point where it stops being the same on every
 * call.
 *
 * Caching is a prefix match: what is cacheable is the longest run of bytes that
 * is identical from one call to the next, measured from the start of the
 * prompt. A single variable interpolated near the top makes everything after it
 * uncacheable, however stable that text is. So the split is declared where the
 * prompt is written rather than guessed here.
 *
 * `stable` is the instructions plus the course-level facts: the same for all
 * fourteen modules of a course. `perCall` is what changes, and goes after the
 * break so it never shifts the prefix.
 */
export interface LlmSystemPrompt {
  stable: string;
  perCall?: string;
}

export type LlmSystem = string | LlmSystemPrompt;

/** The whole system prompt as one string, for providers with no cache control. */
export function systemText(system: LlmSystem | undefined): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return [system.stable, system.perCall].filter(Boolean).join("\n\n");
}

export interface LlmCompletionRequest {
  system?: LlmSystem;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Bias the provider toward strict JSON output when it supports a JSON mode. */
  jsonMode?: boolean;
}

export interface LlmUsage {
  /**
   * The whole prompt, cached parts included.
   *
   * The API reports the uncached remainder here and the cached spans
   * separately; the providers add them back together so this column keeps
   * meaning what it always meant (how big the prompt was) and stays comparable
   * with the runs measured before caching existed. What the cache changes is
   * the price of those tokens, not how many there were, and price is the two
   * fields below.
   */
  tokensIn: number;
  tokensOut: number;
  /** Of `tokensIn`, those served from cache: billed at a tenth of the rate. */
  cacheReadTokens?: number;
  /** Of `tokensIn`, those written to cache: billed at 1.25x the rate. */
  cacheWriteTokens?: number;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
  /**
   * True when the provider stopped because the output hit the token cap, not
   * because the model finished. A structured task can then retry: json-repair
   * happily salvages a cut-off object, so without this signal a module body that
   * stops mid-sentence would pass schema validation and ship truncated.
   */
  truncated: boolean;
}

export interface LlmProvider {
  readonly name: "anthropic" | "openai" | "ollama";
  complete(req: LlmCompletionRequest, model: string): Promise<LlmCompletion>;
}

/** Raised when a provider is selected but not configured (missing key/endpoint). */
export class LlmConfigError extends Error {}

/** Raised when a provider call fails at the transport/API layer. */
export class LlmCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** For 429s: how long the provider asked us to wait, in ms (if known). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
