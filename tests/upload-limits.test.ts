import { describe, expect, it } from "vitest";
import { config } from "../src/middleware";
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  TOTAL_TOO_LARGE_MESSAGE,
  formatBytes,
  oversizeFiles,
  oversizeMessage,
} from "@/lib/http/upload-limits";

describe("saying how big a file is", () => {
  it("does not call a 402 byte file 0 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(402)).toBe("402 B");
    expect(formatBytes(2384)).toBe("2 KB");
  });

  it("reports megabytes as megabytes, not as 11719 KB", () => {
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.0 MB");
    expect(formatBytes(11_999_000)).toBe("11.4 MB");
  });
});

describe("a file over the limit", () => {
  it("is named, with its size and the limit, instead of being skipped", () => {
    const over = oversizeFiles([
      { name: "notes.md", size: 400 },
      { name: "huge.txt", size: 12 * 1024 * 1024 },
    ]);
    expect(over).toEqual([{ name: "huge.txt", size: 12 * 1024 * 1024 }]);
    const msg = oversizeMessage(over);
    expect(msg).toContain("huge.txt");
    expect(msg).toContain("12.0 MB");
    expect(msg).toContain("10.0 MB");
  });

  it("counts the others when there are several", () => {
    const big = 11 * 1024 * 1024;
    const msg = oversizeMessage(oversizeFiles([{ name: "a.pdf", size: big }, { name: "b.pdf", size: big }, { name: "c.pdf", size: big }]));
    expect(msg).toContain("a.pdf");
    expect(msg).toContain("2 more");
  });

  it("allows a file of exactly the limit", () => {
    expect(oversizeFiles([{ name: "edge.md", size: MAX_FILE_BYTES }])).toEqual([]);
  });

  it("explains the request-wide limit in words a person can act on", () => {
    expect(TOTAL_TOO_LARGE_MESSAGE).toContain("50.0 MB");
    expect(MAX_TOTAL_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("the routes that take uploads are not behind the body-copying middleware", () => {
  // Next copies a request's body for middleware and stops at 10 MB, so anything
  // larger reached the handler cut off and was refused as "not a form". The
  // documented limits (10 MB a file, 50 MB a request) were unreachable.
  const re = new RegExp("^" + config.matcher[0] + "$");
  const runsMiddleware = (path: string) => re.test(path);

  it("skips the three that take files", () => {
    for (const p of ["/api/courses", "/api/courses/course_abc/sources", "/api/import", "/api/import/preview"]) {
      expect(runsMiddleware(p), p).toBe(false);
    }
  });

  it("still gates every page and every other API route", () => {
    for (const p of [
      "/",
      "/courses",
      "/courses/course_abc",
      "/settings",
      "/api/auth/login",
      "/api/settings/llm",
      "/api/courses/course_abc",
      "/api/courses/course_abc/proposals",
      "/api/courses/course_abc/sourcesx",
      "/api/coursesx",
      "/api/imports",
    ]) {
      expect(runsMiddleware(p), p).toBe(true);
    }
  });
});
