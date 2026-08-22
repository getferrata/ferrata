import {
  LlmCallError,
  systemText,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../provider";

/**
 * Local Ollama (default provider, runs fully offline, zero cost). Uses the
 * native /api/chat endpoint. `format: "json"` constrains output when jsonMode
 * is requested.
 */

/** One line of Ollama's streaming response. */
interface ChatChunk {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
  error?: string;
}

/**
 * What has arrived so far, plus the tail of a line that has not.
 *
 * Separate from the provider, and pure, so the part with the parsing in it can
 * be tested without a model: the network hands over bytes wherever it likes,
 * including halfway through a token and halfway through a JSON object.
 */
export interface OllamaStream {
  parts: string[];
  tokensIn: number;
  tokensOut: number;
  doneReason: string | null;
  /** A line that arrived incomplete and is waiting for the rest of itself. */
  partial: string;
}

export function newStream(): OllamaStream {
  return { parts: [], tokensIn: 0, tokensOut: 0, doneReason: null, partial: "" };
}

function absorbLine(stream: OllamaStream, line: string): void {
  const text = line.trim();
  if (!text) return;
  let chunk: ChatChunk;
  try {
    chunk = JSON.parse(text) as ChatChunk;
  } catch {
    // Not skipped. A line that will not parse means the stream was cut or the
    // server said something in a shape this code does not know, and dropping it
    // quietly would return a body missing the middle of itself, which then
    // fails a schema check somewhere far away with a useless reason.
    throw new LlmCallError(`Ollama sent a line that is not JSON: ${text.slice(0, 200)}`);
  }
  if (chunk.error) throw new LlmCallError(`Ollama: ${chunk.error}`);
  if (chunk.message?.content) stream.parts.push(chunk.message.content);
  // Counts arrive only on the final line, and are the whole call's, not the
  // line's: last one wins rather than a sum.
  if (typeof chunk.prompt_eval_count === "number") {
    stream.tokensIn = chunk.prompt_eval_count;
  }
  if (typeof chunk.eval_count === "number") stream.tokensOut = chunk.eval_count;
  if (chunk.done_reason) stream.doneReason = chunk.done_reason;
}

/** Take whatever bytes just arrived, decoded, and consume every whole line in them. */
export function absorb(stream: OllamaStream, piece: string): void {
  stream.partial += piece;
  for (;;) {
    const nl = stream.partial.indexOf("\n");
    if (nl < 0) break;
    const line = stream.partial.slice(0, nl);
    stream.partial = stream.partial.slice(nl + 1);
    absorbLine(stream, line);
  }
}

/** Consume the last line, which may have arrived without a newline after it. */
export function seal(stream: OllamaStream): LlmCompletion {
  if (stream.partial) {
    const last = stream.partial;
    stream.partial = "";
    absorbLine(stream, last);
  }
  return {
    text: stream.parts.join(""),
    usage: { tokensIn: stream.tokensIn, tokensOut: stream.tokensOut },
    truncated: stream.doneReason === "length",
  };
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;

  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (
      process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
  }

  async complete(
    req: LlmCompletionRequest,
    model: string,
  ): Promise<LlmCompletion> {
    // A local model costs nothing per token, so there is nothing for a cache to
    // save here: the split is flattened back into one system message.
    const system = systemText(req.system);
    const messages = [
      ...(system ? [{ role: "system", content: system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          // Streamed, and not for the progress bar. Unstreamed, Ollama sends no
          // response headers until the entire answer is written, and Node's
          // fetch abandons a request whose headers have not arrived in five
          // minutes. A 7B model on a CPU passes five minutes on any heavy task,
          // so the call died at exactly 300s reporting the server as
          // unreachable while the server was busy answering it, and the retry
          // did the same thing twice more. Every token now resets that clock.
          stream: true,
          ...(req.jsonMode ? { format: "json" } : {}),
          options: {
            temperature: req.temperature ?? 0.4,
            // Without num_predict Ollama caps output at its own default, which
            // silently truncates a long module body. Honour the per-task budget.
            ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          },
        }),
      });
    } catch (cause) {
      throw new LlmCallError(
        `Ollama unreachable at ${this.baseUrl}. Is \`ollama serve\` running and the model pulled? (${String(cause)})`,
      );
    }

    if (!res.ok) {
      throw new LlmCallError(
        `Ollama ${res.status}: ${await res.text()}`,
        res.status,
      );
    }
    if (!res.body) throw new LlmCallError("Ollama returned no response body");

    const stream = newStream();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) absorb(stream, decoder.decode(value, { stream: true }));
      }
      absorb(stream, decoder.decode());
    } catch (cause) {
      if (cause instanceof LlmCallError) throw cause;
      // Half an answer is worse than no answer: it parses, it validates, and it
      // teaches whoever reads it something the material does not say.
      throw new LlmCallError(
        `Ollama stream broke after ${stream.parts.join("").length} characters (${String(cause)})`,
      );
    }
    return seal(stream);
  }
}
