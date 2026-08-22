import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/util/pool";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("mapWithConcurrency", () => {
  it("returns results in input order, not completion order", async () => {
    // The first item is the slowest, so completion order is the reverse of
    // input order. A caller lining results up against what it passed has to be
    // able to trust the index.
    const out = await mapWithConcurrency([30, 20, 10], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 20, 10]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return null;
    });
    expect(peak).toBe(4);
  });

  it("processes every item even when one throws, then reports the first error", async () => {
    // The point of the whole helper in this codebase: the items are billed
    // model calls, so a failure in one must not abandon calls already in
    // flight, and must not stop the ones not yet started.
    const seen: number[] = [];
    const items = [0, 1, 2, 3, 4, 5];
    await expect(
      mapWithConcurrency(items, 2, async (n) => {
        await tick();
        seen.push(n);
        if (n === 1) throw new Error("first failure");
        if (n === 3) throw new Error("second failure");
        return n;
      }),
    ).rejects.toThrow("first failure");
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("treats a limit above the item count as one lane per item", async () => {
    let peak = 0;
    let running = 0;
    await mapWithConcurrency([1, 2], 50, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return null;
    });
    expect(peak).toBe(2);
  });

  it("falls back to a single lane on a nonsense limit", async () => {
    let peak = 0;
    let running = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return null;
    });
    expect(peak).toBe(1);
  });

  it("does nothing with nothing", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, async () => {
      calls++;
      return null;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});
