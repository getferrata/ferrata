import { describe, expect, it } from "vitest";
import { parseYouTubeId, parseRefs } from "@/lib/video";

describe("parseYouTubeId", () => {
  it("parses watch URLs with extra params", () => {
    expect(
      parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"),
    ).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short URLs", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses embed and shorts URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });
  it("accepts a bare id and rejects junk", () => {
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://example.com/not-a-video")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
  });
});

describe("parseRefs", () => {
  it("returns [] for null/garbage and keeps valid refs", () => {
    expect(parseRefs(null)).toEqual([]);
    expect(parseRefs("not json")).toEqual([]);
    expect(
      parseRefs(JSON.stringify([{ videoId: "abc", url: "u" }, { nope: 1 }])),
    ).toHaveLength(1);
  });
});
