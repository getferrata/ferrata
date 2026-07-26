import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-credits-")),
  "test.db",
);

const { db } = await import("@/db");
const { appSettings, llmCalls } = await import("@/db/schema");
const {
  creditsFor,
  creditLimit,
  spentBy,
  balanceFor,
  assertWithinLimit,
  CreditLimitError,
  CREDIT_LIMIT_KEY,
  CREDIT_WINDOW_KEY,
} = await import("@/lib/llm/credits");
const { withActor, currentActor } = await import("@/lib/llm/actor");
const { newId } = await import("@/lib/util/id");

function charge(userId: string | null, credits: number, at = Date.now()) {
  db.insert(llmCalls)
    .values({
      id: newId("llm"),
      userId,
      task: "write_module",
      provider: "anthropic",
      model: "claude-sonnet-5",
      credits,
      costUsd: credits / 100,
      createdAt: at,
    })
    .run();
}

function setSetting(key: string, value: string) {
  db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value },
  }).run();
}

beforeEach(() => {
  db.delete(llmCalls).run();
  db.delete(appSettings).run();
  delete process.env[CREDIT_LIMIT_KEY];
  delete process.env[CREDIT_WINDOW_KEY];
});

afterEach(() => {
  delete process.env[CREDIT_LIMIT_KEY];
  delete process.env[CREDIT_WINDOW_KEY];
});

describe("creditsFor", () => {
  it("is whole cents, rounded up so a cheap call is never free", () => {
    expect(creditsFor(1)).toBe(100);
    expect(creditsFor(0.42)).toBe(42);
    expect(creditsFor(0.0001)).toBe(1);
  });

  it("is zero for a local model that costs nothing", () => {
    expect(creditsFor(0)).toBe(0);
  });

  it("does not go negative or blow up on nonsense", () => {
    expect(creditsFor(-5)).toBe(0);
    expect(creditsFor(Number.NaN)).toBe(0);
  });
});

describe("the limit", () => {
  it("is off unless somebody sets it", () => {
    expect(creditLimit()).toBeNull();
  });

  it("comes from settings, and settings win over env", () => {
    process.env[CREDIT_LIMIT_KEY] = "100";
    expect(creditLimit()).toBe(100);
    setSetting(CREDIT_LIMIT_KEY, "500");
    expect(creditLimit()).toBe(500);
  });

  it("ignores a value that is not a positive number", () => {
    setSetting(CREDIT_LIMIT_KEY, "not-a-number");
    expect(creditLimit()).toBeNull();
    setSetting(CREDIT_LIMIT_KEY, "-10");
    expect(creditLimit()).toBeNull();
  });
});

describe("spend", () => {
  it("adds up only what this person spent", () => {
    charge("user_a", 30);
    charge("user_a", 12);
    charge("user_b", 99);
    expect(spentBy("user_a")).toBe(42);
    expect(spentBy("user_b")).toBe(99);
  });

  it("is zero for someone who has spent nothing", () => {
    expect(spentBy("user_nobody")).toBe(0);
  });

  it("ignores calls made outside any session", () => {
    charge(null, 500);
    expect(spentBy("user_a")).toBe(0);
  });

  it("only counts what falls inside the window", () => {
    const now = Date.now();
    setSetting(CREDIT_WINDOW_KEY, "30");
    charge("user_a", 10, now - 40 * 24 * 60 * 60 * 1000); // outside
    charge("user_a", 7, now - 2 * 24 * 60 * 60 * 1000); // inside
    expect(spentBy("user_a", now)).toBe(7);
  });

  it("counts everything when the window is zero", () => {
    const now = Date.now();
    setSetting(CREDIT_WINDOW_KEY, "0");
    charge("user_a", 10, now - 400 * 24 * 60 * 60 * 1000);
    expect(spentBy("user_a", now)).toBe(10);
  });
});

describe("assertWithinLimit", () => {
  it("allows everything when no limit is set", () => {
    charge("user_a", 10_000);
    expect(() => assertWithinLimit("user_a")).not.toThrow();
  });

  it("allows a call while there is room", () => {
    setSetting(CREDIT_LIMIT_KEY, "100");
    charge("user_a", 99);
    expect(() => assertWithinLimit("user_a")).not.toThrow();
  });

  it("refuses before spending, once the ceiling is reached", () => {
    setSetting(CREDIT_LIMIT_KEY, "100");
    charge("user_a", 100);
    expect(() => assertWithinLimit("user_a")).toThrow(CreditLimitError);
  });

  it("says how much was used, so the message is actionable", () => {
    setSetting(CREDIT_LIMIT_KEY, "100");
    charge("user_a", 140);
    try {
      assertWithinLimit("user_a");
      throw new Error("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(CreditLimitError);
      expect((err as Error).message).toContain("140");
      expect((err as Error).message).toContain("100");
    }
  });

  it("does not limit work with no actor, such as a seed script", () => {
    setSetting(CREDIT_LIMIT_KEY, "1");
    charge(null, 500);
    expect(() => assertWithinLimit(null)).not.toThrow();
  });

  it("limits each person separately", () => {
    setSetting(CREDIT_LIMIT_KEY, "100");
    charge("user_a", 200);
    expect(() => assertWithinLimit("user_a")).toThrow();
    expect(() => assertWithinLimit("user_b")).not.toThrow();
  });
});

describe("balanceFor", () => {
  it("reports remaining as null when there is no ceiling", () => {
    charge("user_a", 10);
    expect(balanceFor("user_a")).toMatchObject({ limit: null, spent: 10, remaining: null });
  });

  it("never reports a negative remainder", () => {
    setSetting(CREDIT_LIMIT_KEY, "100");
    charge("user_a", 250);
    expect(balanceFor("user_a")).toMatchObject({ limit: 100, spent: 250, remaining: 0 });
  });
});

describe("the actor context", () => {
  it("is null outside any run", () => {
    expect(currentActor()).toBeNull();
  });

  it("carries the user through nested async work", async () => {
    const seen = await withActor({ userId: "user_a" }, async () => {
      await Promise.resolve();
      return currentActor()?.userId;
    });
    expect(seen).toBe("user_a");
    expect(currentActor()).toBeNull();
  });

  it("keeps two concurrent runs apart", async () => {
    const [a, b] = await Promise.all([
      withActor({ userId: "user_a" }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return currentActor()?.userId;
      }),
      withActor({ userId: "user_b" }, async () => currentActor()?.userId),
    ]);
    expect(a).toBe("user_a");
    expect(b).toBe("user_b");
  });
});
