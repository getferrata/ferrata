import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { AnthropicProvider } from "@/lib/llm/providers/anthropic";
import { LlmCallError } from "@/lib/llm/provider";

const OK = {
  content: [{ type: "text", text: '{"ok":true}' }],
  usage: { input_tokens: 10, output_tokens: 5 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Bodies of every request the provider made, parsed. */
function sentBodies(spy: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return spy.mock.calls.map(
    (c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>,
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

const req = { messages: [{ role: "user" as const, content: "go" }] };

describe("a model that refuses temperature", () => {
  it("is retried without it instead of failing the build", () => {
    // Found with a real key: claude-sonnet-5 answers 400 "temperature is
    // deprecated for this model" rather than ignoring the field, and the whole
    // course generation died on it after the earlier stages had already been
    // paid for.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "`temperature` is deprecated for this model.",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(OK));

    return new AnthropicProvider().complete(req, "claude-sonnet-5").then((out) => {
      expect(out.text).toBe('{"ok":true}');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [first, second] = sentBodies(fetchSpy);
      expect(first).toHaveProperty("temperature");
      expect(second).not.toHaveProperty("temperature");
      // The retry is the same request otherwise, not a degraded one.
      expect(second!.model).toBe("claude-sonnet-5");
      expect(second!.messages).toEqual(first!.messages);
    });
  });

  it("sends temperature on the first try, for models that still take it", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(OK));
    await new AnthropicProvider().complete(req, "claude-haiku-4-5-20251001");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentBodies(fetchSpy)[0]).toHaveProperty("temperature");
  });

  it("does not swallow a 400 that is about something else", async () => {
    // Retrying a genuinely malformed request would hide the reason and bill
    // for it twice.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { type: "error", error: { message: "max_tokens: must be >= 1" } },
        400,
      ),
    );
    await expect(
      new AnthropicProvider().complete(req, "claude-sonnet-5"),
    ).rejects.toThrow(LlmCallError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes other failures straight through", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 401));
    await expect(
      new AnthropicProvider().complete(req, "claude-sonnet-5"),
    ).rejects.toThrow(/401/);
  });

  it("reports token usage from the successful attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "temperature is deprecated" } }, 400),
      )
      .mockResolvedValueOnce(jsonResponse(OK));
    const out = await new AnthropicProvider().complete(req, "claude-sonnet-5");
    expect(out.usage).toEqual({ tokensIn: 10, tokensOut: 5 });
  });
});

describe("truncation signal", () => {
  it("marks a completion truncated when the model hit the token cap", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ...OK, stop_reason: "max_tokens" }),
    );
    const out = await new AnthropicProvider().complete(req, "claude-sonnet-5");
    expect(out.truncated).toBe(true);
  });

  it("is not truncated on a normal stop", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ...OK, stop_reason: "end_turn" }),
    );
    const out = await new AnthropicProvider().complete(req, "claude-sonnet-5");
    expect(out.truncated).toBe(false);
  });
});
