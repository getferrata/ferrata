import { describe, expect, it } from "vitest";
import { verifyModule } from "@/lib/llm/tasks/write_module/verify";
import type { RetrievedChunk } from "@/lib/sources/retrieve";

function chunk(name: string, text = "some text"): RetrievedChunk {
  return { sourceId: name, sourceName: name, ord: 0, text, score: 1 };
}

const GOOD_BODY = [
  "## The idea",
  "It is like a receptionist at the front door.",
  "",
  "## What's inside",
  "| a | b |",
  "|---|---|",
  "| one | two |",
  "",
  "## In the real world, for the on-call engineer",
  "The gateway sits at the edge and routes by path.",
  "",
  "## Before this / next to this",
  "Failover sits next to it.",
].join("\n");

describe("verifyModule", () => {
  it("passes a well-formed body with no material", () => {
    const v = verifyModule({ bodyMd: GOOD_BODY, sources: [], depthLevel: 1 });
    expect(v.hard).toEqual([]);
  });

  it("flags a citation that names an unprovided source (hard)", () => {
    const body = `${GOOD_BODY}\n\nSee [source: made-up.md] for detail.`;
    const v = verifyModule({
      bodyMd: body,
      sources: [chunk("runbook.md")],
      depthLevel: 1,
    });
    expect(v.hard.some((h) => h.includes("made-up.md"))).toBe(true);
  });

  it("accepts a citation that matches a provided source, case-insensitively", () => {
    const body = `${GOOD_BODY}\n\nGrounded in [source: Runbook.md].`;
    const v = verifyModule({
      bodyMd: body,
      sources: [chunk("runbook.md")],
      depthLevel: 1,
    });
    expect(v.hard).toEqual([]);
  });

  it("flags a mangled protected placeholder (hard)", () => {
    const body = `${GOOD_BODY}\n\nThe host is ⟨cxt: 9f2a⟩ today.`;
    const v = verifyModule({ bodyMd: body, sources: [], depthLevel: 1 });
    expect(v.hard.some((h) => h.includes("placeholder"))).toBe(true);
  });

  it("accepts a well-formed protected placeholder", () => {
    const body = `${GOOD_BODY}\n\nThe host is ⟨cxt:9f2a1b3c4d⟩ today.`;
    const v = verifyModule({ bodyMd: body, sources: [], depthLevel: 1 });
    expect(v.hard).toEqual([]);
  });

  it("flags a body with no section structure (hard)", () => {
    const v = verifyModule({
      bodyMd: "Just one long paragraph with no headings at all, going on.",
      sources: [],
      depthLevel: 1,
    });
    expect(v.hard.some((h) => h.includes("structure"))).toBe(true);
  });

  it("softly notes material provided but nothing cited", () => {
    const v = verifyModule({
      bodyMd: GOOD_BODY,
      sources: [chunk("runbook.md")],
      depthLevel: 1,
    });
    expect(v.hard).toEqual([]);
    expect(v.soft.some((s) => s.includes("cited"))).toBe(true);
  });

  it("softly notes a body that is thin for its depth", () => {
    const v = verifyModule({ bodyMd: GOOD_BODY, sources: [], depthLevel: 3 });
    expect(v.soft.some((s) => s.includes("thin"))).toBe(true);
  });
});
