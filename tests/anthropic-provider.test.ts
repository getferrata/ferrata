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
    expect(out.usage).toEqual({
      tokensIn: 10,
      tokensOut: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
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

describe("the cache breakpoint", () => {
  /** A stable prefix long enough to clear the provider's caching minimum. */
  const longStable = "You are a stage of Ferrata. ".repeat(700);

  it("marks the stable half and leaves the per-call half unmarked", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(OK));
    await new AnthropicProvider().complete(
      { ...req, system: { stable: longStable, perCall: "Concept: BGP" } },
      "claude-sonnet-5",
    );

    const system = sentBodies(fetchSpy)[0]!.system as {
      text: string;
      cache_control?: unknown;
    }[];
    expect(system).toHaveLength(2);
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[1]!.text).toBe("Concept: BGP");
    // The whole point: what changes per module sits after the breakpoint, so it
    // never shifts the prefix the cache is keyed on.
    expect(system[1]!.cache_control).toBeUndefined();
  });

  it("asks for no cache when the prefix is too short to get one", async () => {
    // A breakpoint under the provider's minimum is not free: it is priced as a
    // write attempt, so a short prompt would pay the premium for a cache that
    // is never created and never read.
    fetchSpy.mockResolvedValueOnce(jsonResponse(OK));
    await new AnthropicProvider().complete(
      { ...req, system: { stable: "Be brief.", perCall: "Concept: BGP" } },
      "claude-sonnet-5",
    );

    const system = sentBodies(fetchSpy)[0]!.system as {
      cache_control?: unknown;
    }[];
    expect(system[0]!.cache_control).toBeUndefined();
  });

  it("keeps the JSON-mode line inside the cached block", async () => {
    // It is a constant. Appended after the breakpoint it would be paid for at
    // full price on every call, for nothing.
    fetchSpy.mockResolvedValueOnce(jsonResponse(OK));
    await new AnthropicProvider().complete(
      { ...req, system: { stable: longStable, perCall: "x" }, jsonMode: true },
      "claude-sonnet-5",
    );

    const system = sentBodies(fetchSpy)[0]!.system as { text: string }[];
    expect(system[0]!.text).toContain("single valid JSON value");
    expect(system[1]!.text).toBe("x");
  });

  it("sends one unmarked block for a prompt that declared no split", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(OK));
    await new AnthropicProvider().complete(
      { ...req, system: longStable },
      "claude-sonnet-5",
    );

    const system = sentBodies(fetchSpy)[0]!.system as {
      cache_control?: unknown;
    }[];
    expect(system).toHaveLength(1);
    expect(system[0]!.cache_control).toBeUndefined();
  });

  it("counts cached tokens back into the prompt size", async () => {
    // The API reports the uncached remainder in input_tokens and the cached
    // spans beside it. Left as-is, a cache hit would look like the prompt had
    // shrunk, and every figure built on tokensIn would quietly disagree with
    // the runs measured before caching existed.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: "{}" }],
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 0,
        },
      }),
    );
    const out = await new AnthropicProvider().complete(req, "claude-sonnet-5");
    expect(out.usage.tokensIn).toBe(4200);
    expect(out.usage.cacheReadTokens).toBe(4000);
    expect(out.usage.cacheWriteTokens).toBe(0);
  });
});
