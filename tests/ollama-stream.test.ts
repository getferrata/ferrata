import { describe, expect, it } from "vitest";
import { absorb, newStream, seal } from "@/lib/llm/providers/ollama";
import { LlmCallError } from "@/lib/llm/provider";

/**
 * Reading Ollama's streamed answer.
 *
 * The reason it is streamed at all is a five minute timeout: unstreamed, no
 * response header arrives until the whole answer is written, and Node gives up
 * waiting. A 7B on a CPU passes five minutes on a heavy task, and the call came
 * back saying the server was unreachable while the server was busy answering
 * it. Streaming trades that for a parser, and a parser fed by a network has to
 * survive being handed half a line.
 */

const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const say = (content: string): string => line({ message: { content } });
const finish = (extra: Record<string, unknown> = {}): string =>
  line({
    message: { content: "" },
    done: true,
    prompt_eval_count: 120,
    eval_count: 40,
    ...extra,
  });

function read(pieces: string[]): ReturnType<typeof seal> {
  const s = newStream();
  for (const p of pieces) absorb(s, p);
  return seal(s);
}

describe("assembling a streamed answer", () => {
  it("joins the tokens in order and takes the counts from the last line", () => {
    const out = read([say("Una "), say("sessione "), say("BGP."), finish()]);
    expect(out.text).toBe("Una sessione BGP.");
    expect(out.usage).toEqual({ tokensIn: 120, tokensOut: 40 });
    expect(out.truncated).toBe(false);
  });

  it("survives a chunk that ends in the middle of a line", () => {
    // What a socket actually does. Splitting inside the JSON of one token was
    // the failure this parser exists to not have.
    const whole = `${say("Una ")}${say("sessione")}${finish()}`;
    const cut = Math.floor(whole.length / 3);
    const out = read([whole.slice(0, cut), whole.slice(cut, cut * 2), whole.slice(cut * 2)]);
    expect(out.text).toBe("Una sessione");
    expect(out.usage.tokensIn).toBe(120);
  });

  it("survives one byte at a time", () => {
    const whole = `${say("abc")}${finish()}`;
    expect(read([...whole]).text).toBe("abc");
  });

  it("reads a last line that arrived without a newline after it", () => {
    const s = newStream();
    absorb(s, say("mezzo"));
    absorb(s, JSON.stringify({ message: { content: " e mezzo" }, eval_count: 9 }));
    const out = seal(s);
    expect(out.text).toBe("mezzo e mezzo");
    expect(out.usage.tokensOut).toBe(9);
  });

  it("ignores the blank lines between objects", () => {
    expect(read([say("a"), "\n\n", say("b"), finish()]).text).toBe("ab");
  });

  it("reports the model hitting its output cap", () => {
    expect(read([say("tronco"), finish({ done_reason: "length" })]).truncated).toBe(
      true,
    );
  });

  it("raises what the server said instead of returning an empty answer", () => {
    expect(() => read([line({ error: "model not found" })])).toThrow(LlmCallError);
    expect(() => read([line({ error: "model not found" })])).toThrow(
      /model not found/,
    );
  });

  it("refuses a line it cannot parse rather than dropping the middle of the answer", () => {
    // Dropping it silently returns a body missing a piece of itself, which then
    // fails a schema check somewhere far away for a reason that names the wrong
    // thing.
    expect(() => read([say("inizio"), "{not json}\n", say("fine")])).toThrow(
      LlmCallError,
    );
  });

  it("returns an empty answer, not a crash, when the model said nothing", () => {
    const out = read([finish()]);
    expect(out.text).toBe("");
    expect(out.usage.tokensIn).toBe(120);
  });
});
