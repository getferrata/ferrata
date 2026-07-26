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

export interface LlmCompletionRequest {
  system?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Bias the provider toward strict JSON output when it supports a JSON mode. */
  jsonMode?: boolean;
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
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
