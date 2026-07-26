import { describe, expect, it } from "vitest";
import { gradeFor, retrievability, review } from "@/lib/fsrs";
import { Rating } from "ts-fsrs";

describe("gradeFor", () => {
  it("maps a wrong answer to Again", () => {
    expect(gradeFor(false, "high")).toBe(Rating.Again);
    expect(gradeFor(false, "low")).toBe(Rating.Again);
  });

  it("maps confidence to Hard/Good/Easy when correct", () => {
    expect(gradeFor(true, "low")).toBe(Rating.Hard);
    expect(gradeFor(true, "medium")).toBe(Rating.Good);
    expect(gradeFor(true, "high")).toBe(Rating.Easy);
  });
});

describe("review", () => {
  it("creates a first card and schedules it into the future when correct", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const { next } = review(null, true, "high", now);
    expect(next.reps).toBe(1);
    expect(new Date(next.due).getTime()).toBeGreaterThan(now.getTime());
  });

  it("a sure-and-wrong answer lands as a lapse-prone Again card", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    // first learn it well
    const first = review(null, true, "high", now).next;
    // then miss it while confident
    const { next, grade } = review(first, false, "high", now);
    expect(grade).toBe(Rating.Again);
    expect(next.due).toBeTruthy();
  });

  it("retrievability of a fresh correct card is high and falls over time", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const card = review(null, true, "medium", now).next;
    const rNow = retrievability(card, now);
    const rLater = retrievability(
      card,
      new Date("2026-02-01T10:00:00Z"),
    );
    expect(rNow).toBeGreaterThan(rLater);
    expect(rNow).toBeLessThanOrEqual(1);
  });
});
