import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatDate, formatDateTime } from "@/lib/format-date";

const WHEN = Date.UTC(2026, 9, 7, 9, 47, 45); // 7 October 2026

describe("dates in the interface", () => {
  it("write the month as a word, so 7 October is never read as 10 July", () => {
    expect(formatDate(WHEN, "UTC")).toBe("7 Oct 2026");
    expect(formatDate(Date.UTC(2026, 6, 10), "UTC")).toBe("10 Jul 2026");
  });

  it("carry the time and its zone when there is a time", () => {
    expect(formatDateTime(WHEN, "UTC")).toBe("7 Oct 2026, 09:47 UTC");
  });

  it("accept the forms the database and the API hand over", () => {
    expect(formatDate(new Date(WHEN), "UTC")).toBe("7 Oct 2026");
    expect(formatDate(new Date(WHEN).toISOString(), "UTC")).toBe("7 Oct 2026");
  });
});

describe("no component writes a date its own way", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
    });

  it("uses the shared formatter instead of toLocale…String", () => {
    const offenders = [...walk("src/app"), ...walk("src/components")].filter((f) =>
      /\.toLocale(?:Date|Time)?String\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
