import {
  LlmCallError,
  LlmConfigError,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../provider";

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

    const system = [
      req.system,
      req.jsonMode
        ? "Respond with a single valid JSON value and nothing else. No prose, no code fences."
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");

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
          ...(system ? { system } : {}),
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
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      text,
      usage: {
        tokensIn: data.usage.input_tokens,
        tokensOut: data.usage.output_tokens,
      },
    };
  }
}
