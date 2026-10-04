import { describe, expect, it } from "vitest";
import { withHashSlot } from "@/lib/auth/gate";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("the cap on concurrent password hashes", () => {
  it("never runs more than three at once, and finishes everything it accepted", async () => {
    let live = 0;
    let peak = 0;
    const job = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await tick();
      live -= 1;
      return "done";
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => withHashSlot(job)));
    expect(peak).toBe(3);
    expect(results.every((r) => r === "done")).toBe(true);
  });

  it("turns callers away once the queue is full, instead of piling up", async () => {
    const release: Array<() => void> = [];
    const hold = () => new Promise<string>((r) => release.push(() => r("ok")));
    const accepted = Array.from({ length: 27 }, () => withHashSlot(hold)); // 3 running + 24 waiting
    await tick();
    expect(await withHashSlot(async () => "late")).toBeNull();
    // Drain, so the next test starts with every slot free.
    while (release.length) {
      release.shift()!();
      await tick();
    }
    expect((await Promise.all(accepted)).every((r) => r === "ok")).toBe(true);
  });

  it("frees the slot when the job throws", async () => {
    for (let i = 0; i < 10; i++) {
      await expect(withHashSlot(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }
    expect(await withHashSlot(async () => "still works")).toBe("still works");
  });
});
