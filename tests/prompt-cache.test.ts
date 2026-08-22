import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PER_CALL_MARKER, splitPrompt } from "@/lib/llm/run";
import { isCacheable } from "@/lib/llm/providers/anthropic";

const promptFor = (task: string): string =>
  readFileSync(
    resolve(process.cwd(), "src/lib/llm/tasks", task, "prompt.md"),
    "utf8",
  );

/**
 * The stages that run once per module, and so are the only ones a cache can pay
 * for: the prefix is written on the first module and read on the other
 * thirteen.
 */
const PER_MODULE_TASKS = [
  "write_module",
  "concreteness_pass",
  "eval_judge",
  "write_questions",
];

/**
 * Variables whose value is different for every module. One of these above the
 * marker moves the prefix on every call, and nothing after it can ever be read
 * from cache.
 */
const PER_MODULE_VARS = [
  "conceptTitle",
  "conceptSummary",
  "depthLevel",
  "prerequisites",
  "count",
];

describe("splitPrompt", () => {
  it("splits at the marker and drops it from both halves", () => {
    const split = splitPrompt(`instructions\n\n${PER_CALL_MARKER}\n\nthe module`);
    expect(split).toEqual({ stable: "instructions", perCall: "the module" });
  });

  it("leaves a prompt without a marker as a plain string", () => {
    // The marker is the opt-in. A stage that runs once per course must not ask
    // for a cache: the write costs a quarter more than the call it replaces and
    // nothing ever reads it back.
    expect(splitPrompt("just instructions")).toBe("just instructions");
  });

  it("splits at the first marker if a prompt somehow carries two", () => {
    const split = splitPrompt(
      `a\n${PER_CALL_MARKER}\nb\n${PER_CALL_MARKER}\nc`,
    );
    expect(split).toMatchObject({ stable: "a" });
    expect((split as { perCall: string }).perCall).toContain("b");
  });
});

describe("the prompts that pay for a cache", () => {
  it.each(PER_MODULE_TASKS)("%s declares where it stops being stable", (task) => {
    expect(promptFor(task)).toContain(PER_CALL_MARKER);
  });

  it.each(PER_MODULE_TASKS)(
    "%s keeps every per-module variable below the marker",
    (task) => {
      // This is the test that keeps caching working. Everything else about it is
      // configuration; this is the invariant, and it is the one an ordinary
      // prompt edit breaks without anybody noticing, because a broken cache
      // looks exactly like a working one from the outside: same output, same
      // logs, quietly full price.
      const split = splitPrompt(promptFor(task));
      expect(typeof split).toBe("object");
      const { stable } = split as { stable: string };
      for (const name of PER_MODULE_VARS) {
        expect(stable).not.toContain(`{{${name}}}`);
      }
    },
  );

  it.each(PER_MODULE_TASKS)("%s still interpolates what it moved", (task) => {
    // Moving a variable below the marker must not lose it: the module would be
    // written without knowing which concept it is about.
    const text = promptFor(task);
    const used = PER_MODULE_VARS.filter((v) => text.includes(`{{${v}}}`));
    expect(used.length).toBeGreaterThan(0);
  });

  it.each(PER_MODULE_TASKS)("%s leaves almost nothing below the marker", (task) => {
    // Everything below the marker is paid for at full price on every call, so
    // the tail should be the module's own facts and nothing else. A tail that
    // grows is course-level text that drifted down and is now being bought
    // fourteen times.
    const { perCall } = splitPrompt(promptFor(task)) as { perCall: string };
    expect(perCall.length).toBeLessThan(400);
  });

  it("caches every per-module stage on the cheapest-to-cache model", () => {
    // Template alone, before any course-level variable is interpolated: on a
    // 512-token minimum all four clear it outright.
    for (const task of PER_MODULE_TASKS) {
      const { stable } = splitPrompt(promptFor(task)) as { stable: string };
      expect(isCacheable(stable, "claude-opus-5")).toBe(true);
    }
  });

  it("caches the most expensive stage on the model the benchmarks used", () => {
    // write_module is the long prompt and the big output cap, so it is the one
    // worth being sure about. The other three sit between 775 and 982 tokens
    // against this model's 1024, which the author's brief pushes them over on a
    // real course but the bare template does not: that is a genuine limit, not
    // a bug, and the provider logs each time a prefix falls short.
    const { stable } = splitPrompt(promptFor("write_module")) as {
      stable: string;
    };
    expect(isCacheable(stable, "claude-sonnet-5")).toBe(true);
  });

  it("refuses to cache for a model it has never heard of", () => {
    // Same reasoning as the price table: an unknown model gets the
    // conservative figure, so a new name cannot quietly start paying the write
    // premium for a cache it will not create.
    const long = "x".repeat(3000 * 4);
    expect(isCacheable(long, "claude-opus-5")).toBe(true);
    expect(isCacheable(long, "some-model-shipped-next-year")).toBe(false);
  });
});
