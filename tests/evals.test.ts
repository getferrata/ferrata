import { describe, expect, it } from "vitest";
import { runRubrics, type ModuleContext } from "@/lib/evals/rubrics";

const ctx: ModuleContext = {
  domain: "provider networking",
  anchorTerms: ["Acme", "Zurich", "AS64500", "TransitCo", "EDGE1", "MetroIX"],
};

// Anchored and concrete, with an everyday analogy: the shape that passes.
const GOOD = `
Walk into Acme's data center in Zurich. You see rows of metal cabinets two
meters tall, the racks. Inside EDGE1 there is an operating system: you SSH into
it like any Linux box.

Fiber A, toward TransitCo, is transit: an invoice arrives every month, around
4000 francs. Fiber C goes to MetroIX, where you pay only the port, about 300
francs for 10 Gbps.

Analogy: transit is the rail pass that takes you anywhere and you pay for it;
peering is the pact with your neighbor, free but only between the two of you.

Acme is AS64500. Every Gbps that flows over the peering port is a Gbps you do
not pay TransitCo for.
`;

// Generic filler that would fit any subject: the shape that fails.
const GENERIC = `
This concept is very important and must be understood well to master the topic.

It is fundamental to grasp how it works, because it forms the basis of
everything else. With careful study, anyone can come to understand it fully.

In general, this topic connects to many others and deserves time and dedication.
`;

describe("runRubrics", () => {
  it("passes an anchored, concrete, analogy-bearing module", () => {
    const r = runRubrics(GOOD, ctx);
    expect(r.pass).toBe(true);
    expect(r.checks.find((c) => c.name === "specificity")!.pass).toBe(true);
    expect(r.checks.find((c) => c.name === "analogy_present")!.pass).toBe(true);
  });

  it("fails generic filler on the specificity gate", () => {
    const r = runRubrics(GENERIC, ctx);
    expect(r.pass).toBe(false);
    expect(r.checks.find((c) => c.name === "specificity")!.pass).toBe(false);
  });
});
