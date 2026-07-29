import {
  LlmCallError,
  LlmConfigError,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../provider";

/**
 * Any OpenAI-compatible chat-completions endpoint (OpenAI, Groq, Together,
 * a local llama.cpp/vLLM server…). `system` becomes a system message.
 */
const REQUEST_TIMEOUT_MS = 90_000;

/** Groq keys are `gsk_...`; no other OpenAI-compatible host uses that prefix. */
export function isGroqKey(key: string | undefined): boolean {
  return Boolean(key?.trim().startsWith("gsk_"));
}

export class OpenAICompatProvider implements LlmProvider {
  readonly name = "openai" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    // Accept a Groq key too: same OpenAI-compatible wire format, just a
    // different host. Explicit OPENAI_* always wins if both are set.
    const key = process.env.OPENAI_API_KEY ?? process.env.GROQ_API_KEY;
    if (!key) {
      throw new LlmConfigError("OPENAI_API_KEY or GROQ_API_KEY is not set");
    }
    this.apiKey = key;
    // Recognise a Groq key by its shape, not by which variable it was put in.
    // Settings offers one "OpenAI and compatible" slot, so a Groq key arrives in
    // OPENAI_API_KEY and would otherwise be sent to api.openai.com.
    const fallbackUrl = isGroqKey(key)
      ? "https://api.groq.com/openai/v1"
      : "https://api.openai.com/v1";
    this.baseUrl = (process.env.OPENAI_BASE_URL ?? fallbackUrl).replace(
      /\/$/,
      "",
    );
  }

  async complete(
    req: LlmCompletionRequest,
    model: string,
  ): Promise<LlmCompletion> {
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // A hung connection must not block the worker forever. Abort after a
    // generous ceiling; the call layer treats it as a retryable transport error.
    const send = async (withJsonMode: boolean): Promise<Response> => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: req.temperature ?? 0.4,
            max_tokens: req.maxTokens ?? 4096,
            ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
            messages,
          }),
          signal: ctrl.signal,
        });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        throw new LlmCallError(
          aborted
            ? `OpenAI-compatible request timed out after ${REQUEST_TIMEOUT_MS}ms`
            : `OpenAI-compatible network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    };

    const wantJson =
      Boolean(req.jsonMode) && process.env.OPENAI_NO_JSON_MODE !== "1";
    let res = await send(wantJson);

    // Some endpoints (Perplexity: response_format must be json_schema or text)
    // reject json_object. If that's the 400, retry once as plain text: the
    // prompts already ask for JSON and extractJson recovers it from prose.
    if (!res.ok && res.status === 400 && wantJson) {
      const peek = await res.clone().text();
      if (/response_format/i.test(peek)) res = await send(false);
    }

    if (!res.ok) {
      const bodyText = await res.text();
      // On 429, honour the wait the API asks for: the Retry-After header, or the
      // "try again in 5.6s / 194ms" hint many gateways (Groq) put in the body.
      let retryAfterMs: number | undefined;
      if (res.status === 429) {
        const header = res.headers.get("retry-after");
        if (header && Number.isFinite(Number(header))) {
          retryAfterMs = Number(header) * 1000;
        } else {
          const m = bodyText.match(/try again in\s+([\d.]+)\s*(ms|s)/i);
          if (m && m[1]) {
            retryAfterMs = Math.ceil(
              Number(m[1]) * (m[2]?.toLowerCase() === "ms" ? 1 : 1000),
            );
          }
        }
      }
      throw new LlmCallError(
        `OpenAI-compatible ${res.status}: ${bodyText}`,
        res.status,
        retryAfterMs,
      );
    }

    const data = (await res.json()) as {
      choices: { message: { content: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0]?.message.content ?? "",
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
      },
      truncated: data.choices[0]?.finish_reason === "length",
    };
  }
}
