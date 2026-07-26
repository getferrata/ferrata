import {
  LlmCallError,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../provider";

/**
 * Local Ollama (default provider, runs fully offline, zero cost). Uses the
 * native /api/chat endpoint. `format: "json"` constrains output when jsonMode
 * is requested.
 */
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
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
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
          stream: false,
          ...(req.jsonMode ? { format: "json" } : {}),
          options: { temperature: req.temperature ?? 0.4 },
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

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: data.message?.content ?? "",
      usage: {
        tokensIn: data.prompt_eval_count ?? 0,
        tokensOut: data.eval_count ?? 0,
      },
    };
  }
}
