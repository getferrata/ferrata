import { getLogger } from "@/lib/log";
import {
  LlmCallError,
  LlmConfigError,
  systemText,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../provider";

const log = getLogger("llm");

/**
 * The shortest prefix each model will cache, in tokens.
 *
 * Below its model's figure a breakpoint is accepted and quietly does nothing:
 * no write happens, no error is returned, and every call pays full price while
 * the code looks like it is saving money. The figure is not monotonic across
 * generations, so it cannot be guessed from the model name.
 *
 * Kept per model rather than taking the highest of them, which was the first
 * thing tried here. The highest is 4096, the four prompts that carry a cache
 * marker have prefixes between 690 and 1640 tokens, and a single conservative
 * gate therefore refused all four: the whole feature would have shipped inert
 * and passed its own tests. An unknown model still gets the conservative
 * figure, on the same reasoning as the price table.
 */
const CACHE_MIN_TOKENS: Record<string, number> = {
  "claude-opus-5": 512,
  "claude-opus-4-8": 1024,
  "claude-sonnet-5": 1024,
  "claude-sonnet-4-6": 1024,
  "claude-opus-4-7": 2048,
  "claude-opus-4-6": 4096,
  "claude-haiku-4-5-20251001": 4096,
};
const UNKNOWN_MIN_TOKENS = 4096;

/** Characters per token, the usual rough figure. Approximate is enough here. */
const CHARS_PER_TOKEN = 4;

/** Whether a prefix of this length is long enough for this model to cache it. */
export function isCacheable(stable: string, model: string): boolean {
  const min = CACHE_MIN_TOKENS[model] ?? UNKNOWN_MIN_TOKENS;
  return stable.length >= min * CHARS_PER_TOKEN;
}

/**
 * Anthropic Messages API via fetch. `system` is a top-level field; only
 * user/assistant turns go in `messages`.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new LlmConfigError("ANTHROPIC_API_KEY is not set");
    }
    this.apiKey = key;
    this.baseUrl = (
      process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
    ).replace(/\/$/, "");
  }

  async complete(
    req: LlmCompletionRequest,
    model: string,
  ): Promise<LlmCompletion> {
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const system = buildSystem(req, model);

    const send = (withTemperature: boolean) =>
      fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          ...(withTemperature ? { temperature: req.temperature ?? 0.4 } : {}),
          ...(system.length > 0 ? { system } : {}),
          messages,
        }),
      });

    let res = await send(true);

    // Newer models reject `temperature` outright rather than ignoring it, and
    // which ones do changes over time. Rather than keep a list that goes stale,
    // read the refusal and send the same request without it. One wasted
    // round trip on the first call of a run, and no model to add by hand later.
    if (res.status === 400) {
      const body = await res.text();
      if (/temperature/i.test(body)) {
        res = await send(false);
      } else {
        throw new LlmCallError(`Anthropic API 400: ${body}`, 400);
      }
    }

    if (!res.ok) {
      throw new LlmCallError(
        `Anthropic API ${res.status}: ${await res.text()}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      stop_reason?: string;
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    // input_tokens is the uncached remainder; the cached spans are reported
    // beside it. Added back together so tokensIn stays "how big the prompt
    // was", which is what every figure built on it already means.
    const cacheWriteTokens = data.usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = data.usage.cache_read_input_tokens ?? 0;

    return {
      text,
      usage: {
        tokensIn: data.usage.input_tokens + cacheWriteTokens + cacheReadTokens,
        tokensOut: data.usage.output_tokens,
        cacheWriteTokens,
        cacheReadTokens,
      },
      truncated: data.stop_reason === "max_tokens",
    };
  }
}

/**
 * The system prompt as content blocks, with a cache breakpoint after the part
 * that does not change between calls.
 *
 * The JSON-mode line goes inside the cached block on purpose: it is a constant,
 * and anything appended after the breakpoint would be paid for at full price on
 * every call for no reason.
 *
 * A prefix too short to cache is sent without a breakpoint. Asking for a cache
 * that cannot be created is not free: the request is priced as a write attempt,
 * so the cheap stages would pay a premium for a cache nobody ever reads.
 */
function buildSystem(
  req: LlmCompletionRequest,
  model: string,
): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const jsonLine = req.jsonMode
    ? "Respond with a single valid JSON value and nothing else. No prose, no code fences."
    : "";

  const split =
    typeof req.system === "object" && req.system !== null ? req.system : null;
  if (!split) {
    const text = [systemText(req.system), jsonLine].filter(Boolean).join("\n\n");
    return text ? [{ type: "text", text }] : [];
  }

  const stable = [split.stable, jsonLine].filter(Boolean).join("\n\n");
  const blocks: {
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }[] = [];
  if (stable) {
    const cacheable = isCacheable(stable, model);
    if (!cacheable) {
      // Said out loud, because this is the branch where a feature that is
      // supposed to be saving money is doing nothing at all, and it has no
      // other symptom: same output, same logs, full price.
      log.warn(
        `prompt asked for a cache but its prefix is ${Math.round(stable.length / CHARS_PER_TOKEN)} tokens, under what ${model} will cache; sending it uncached`,
      );
    }
    blocks.push({
      type: "text",
      text: stable,
      ...(cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
    });
  }
  if (split.perCall) blocks.push({ type: "text", text: split.perCall });
  return blocks;
}
