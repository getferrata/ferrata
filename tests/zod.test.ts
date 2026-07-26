import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ciEnum } from "@/lib/llm/zod";

describe("ciEnum (case-insensitive enum for small-model output)", () => {
  const priority = ciEnum(["critical", "high", "medium", "low"]);

  it("normalizes miscased values to the canonical casing", () => {
    expect(priority.parse("Critical")).toBe("critical");
    expect(priority.parse("HIGH")).toBe("high");
    expect(priority.parse(" Medium ")).toBe("medium");
    expect(priority.parse("low")).toBe("low");
  });

  it("still rejects values that are not in the enum", () => {
    expect(priority.safeParse("urgent").success).toBe(false);
    expect(priority.safeParse("").success).toBe(false);
    expect(priority.safeParse(3).success).toBe(false);
  });

  it("works inside an object schema (the real usage)", () => {
    const schema = z.object({ p: ciEnum(["open", "mcq"]) });
    expect(schema.parse({ p: "MCQ" })).toEqual({ p: "mcq" });
    expect(schema.safeParse({ p: "essay" }).success).toBe(false);
  });
});
