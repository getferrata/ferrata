import { describe, expect, it } from "vitest";
import { breakCycles, findCycle, topoSort, type DagEdge } from "@/lib/graph/dag";
import { triage, type TriageConcept } from "@/lib/graph/triage";
import type { Priority } from "@/db/schema";

describe("topoSort", () => {
  it("orders prerequisites before dependents", () => {
    const nodes = ["cidr", "ospf", "bgp"];
    const edges: DagEdge[] = [
      { from: "cidr", to: "bgp" },
      { from: "ospf", to: "bgp" },
    ];
    const order = topoSort(nodes, edges);
    expect(order.indexOf("cidr")).toBeLessThan(order.indexOf("bgp"));
    expect(order.indexOf("ospf")).toBeLessThan(order.indexOf("bgp"));
  });

  it("is deterministic in input order for independent nodes", () => {
    expect(topoSort(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("throws on a cycle", () => {
    expect(() =>
      topoSort(["a", "b"], [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ]),
    ).toThrow(/cycle/);
  });
});

describe("findCycle", () => {
  it("returns null on a DAG", () => {
    expect(findCycle(["a", "b"], [{ from: "a", to: "b" }])).toBeNull();
  });

  it("finds a cycle when present", () => {
    const cyc = findCycle(["a", "b", "c"], [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ]);
    expect(cyc).not.toBeNull();
    expect(cyc!.length).toBe(3);
  });
});

describe("breakCycles", () => {
  it("leaves an acyclic graph untouched", () => {
    const edges: DagEdge[] = [{ from: "a", to: "b" }];
    const { edges: kept, removed } = breakCycles(["a", "b"], edges, () => "high");
    expect(kept).toEqual(edges);
    expect(removed).toHaveLength(0);
  });

  it("removes the edge into the lowest-priority node to break a cycle", () => {
    const prio: Record<string, Priority> = {
      a: "critical",
      b: "low",
      c: "high",
    };
    const edges: DagEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    const { edges: kept, removed } = breakCycles(
      ["a", "b", "c"],
      edges,
      (id) => prio[id]!,
    );
    expect(removed).toHaveLength(1);
    // the removed edge points INTO the lowest-priority node (b)
    expect(removed[0]!.to).toBe("b");
    // result is now acyclic
    expect(findCycle(["a", "b", "c"], kept)).toBeNull();
  });
});

describe("triage", () => {
  const c = (
    id: string,
    priority: Priority,
    estimatedMinutes: number,
  ): TriageConcept => ({ id, title: id, priority, estimatedMinutes });

  it("keeps everything when there is no budget", () => {
    const concepts = [c("a", "high", 60), c("b", "low", 60)];
    const r = triage(concepts, [], null);
    expect(r.survivorIds.sort()).toEqual(["a", "b"]);
    expect(r.cuts).toHaveLength(0);
    expect(r.feasible).toBe(true);
  });

  it("cuts low-priority terminal concepts to fit the budget", () => {
    const concepts = [
      c("bgp", "critical", 120),
      c("ospf", "high", 45),
      c("trivia", "low", 60),
    ];
    // trivia depends on nothing and nothing depends on it → removable.
    const r = triage(concepts, [], 180);
    expect(r.survivorIds.sort()).toEqual(["bgp", "ospf"]);
    expect(r.cuts.map((x) => x.id)).toEqual(["trivia"]);
    expect(r.feasible).toBe(true);
    expect(r.totalMinutes).toBe(165);
  });

  it("never cuts a prerequisite of a survivor", () => {
    // cidr is low priority but is a prerequisite of bgp (critical) → protected.
    const concepts = [c("bgp", "critical", 120), c("cidr", "low", 30)];
    const edges: DagEdge[] = [{ from: "cidr", to: "bgp" }];
    const r = triage(concepts, edges, 100); // 150 > 100, but nothing cuttable
    expect(r.survivorIds.sort()).toEqual(["bgp", "cidr"]);
    expect(r.feasible).toBe(false); // declared, not silently compressed
  });

  it("declares infeasible instead of cutting protected goals", () => {
    const concepts = [c("bgp", "critical", 300)];
    const r = triage(concepts, [], 120);
    expect(r.survivorIds).toEqual(["bgp"]);
    expect(r.cuts).toHaveLength(0);
    expect(r.feasible).toBe(false);
  });
});
