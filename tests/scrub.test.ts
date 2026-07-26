import { describe, expect, it } from "vitest";
import { scrubTemplateArtifacts } from "@/lib/course/scrub";

describe("scrubTemplateArtifacts", () => {
  it("removes inline skeleton slots but keeps the sentence around them", () => {
    const md = "### In the real world, for <the learner, their system and deadline by name>\nActual grounded paragraph.";
    const out = scrubTemplateArtifacts(md);
    expect(out).not.toContain("<the learner");
    expect(out).toContain("Actual grounded paragraph.");
    expect(out).not.toMatch(/^#{1,6}\s*In the real world[,.]?\s*(for)?\s*$/im);
  });

  it("drops a leaked briefing block wholesale", () => {
    const md = [
      "## The learner and the course",
      "- Real goal: Onboard a new on-call engineer.",
      "- Domain: Kubernetes-based platform.",
      "- The learner starts at: A fresh onboarding.",
      "- Their actual situation, in their words: They are onboarded.",
      "- The concreteness compact this course holds to: The course is tailored.",
      "",
      "## The idea",
      "Real teaching content stays.",
    ].join("\n");
    const out = scrubTemplateArtifacts(md);
    expect(out).not.toContain("The learner and the course");
    expect(out).not.toContain("Real goal:");
    expect(out).toContain("Real teaching content stays.");
  });

  it("drops leaked instruction headings and stray briefing bullets", () => {
    const md = [
      "## Required anatomy",
      "### The idea, in a couple of lines",
      "A 503 means the backend pool is empty.",
      "- Depth to reach: 3 (for-dummies framing at depth 0).",
      "- Profondità: Operativo.",
    ].join("\n");
    const out = scrubTemplateArtifacts(md);
    expect(out).not.toContain("Required anatomy");
    expect(out).not.toContain("Depth to reach");
    expect(out).not.toContain("Profondità");
    expect(out).toContain("A 503 means the backend pool is empty.");
    expect(out).toContain("The idea, in a couple of lines");
  });

  it("wraps angle-bracket slot content in module 3 style leaks", () => {
    const md = "<The gateway failover mechanism works like a backup engine.>\nKeepalived manages the VIP.";
    const out = scrubTemplateArtifacts(md);
    // Sentence-style bracket wrap starts with "The": stripped by the slot rule.
    expect(out).not.toContain("<The gateway");
    expect(out).toContain("Keepalived manages the VIP.");
  });

  it("never touches fenced code blocks or code generics", () => {
    const md = [
      "Use a typed vector:",
      "```rust",
      "let x: Vec<String> = vec![];",
      "// - Real goal: keep this comment",
      "## Required anatomy (inside fence, keep)",
      "```",
      "Inline generics like `Map<the key, the value>` outside fences survive when phrase-unlike, and autolinks <https://example.com> survive.",
    ].join("\n");
    const out = scrubTemplateArtifacts(md);
    expect(out).toContain("Vec<String>");
    expect(out).toContain("- Real goal: keep this comment");
    expect(out).toContain("## Required anatomy (inside fence, keep)");
    expect(out).toContain("<https://example.com>");
  });

  it("leaves a clean module untouched", () => {
    const md = [
      "## The single front door",
      "The edge gateway terminates TLS, like the main door of a building.",
      "",
      "| Primary | Secondary |",
      "|---|---|",
      "| gw-prod-01 | gw-prod-02 |",
    ].join("\n");
    expect(scrubTemplateArtifacts(md)).toBe(md);
  });
});
