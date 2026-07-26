import type { Priority } from "@/db/schema";

/**
 * Directed edge: `from` is a prerequisite of `to` (from must be studied first).
 */
export interface DagEdge {
  from: string;
  to: string;
}

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Kahn topological sort. Returns node ids in an order where every prerequisite
 * precedes its dependents. Throws if the graph has a cycle (call breakCycles
 * first). Ties are broken by the given ordering to keep output deterministic.
 */
export function topoSort(nodeIds: string[], edges: DagEdge[]): string[] {
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of nodeIds) {
    indeg.set(id, 0);
    out.set(id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue; // ignore dangling
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // Ready set kept in the input order for stable output.
  const ready = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) ready.push(next);
    }
  }

  if (order.length !== nodeIds.length) {
    throw new Error("topoSort: graph contains a cycle");
  }
  return order;
}

/**
 * Find one cycle if present, returned as the ordered node ids on the cycle.
 * Null when the graph is acyclic. Used for logging what was broken.
 */
export function findCycle(nodeIds: string[], edges: DagEdge[]): string[] | null {
  const out = new Map<string, string[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const e of edges) {
    if (out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));
  const stack: string[] = [];

  function dfs(u: string): string[] | null {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of out.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) {
        // back edge → cycle from v's position on the stack to u.
        const idx = stack.indexOf(v);
        return stack.slice(idx);
      }
      if (c === WHITE) {
        const found = dfs(v);
        if (found) return found;
      }
    }
    color.set(u, BLACK);
    stack.pop();
    return null;
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

export interface BrokenEdge extends DagEdge {
  reason: string;
}

/**
 * Make the graph acyclic by removing edges, deterministically and with a log.
 * For each cycle found, remove the edge pointing INTO the lowest-priority node
 * on the cycle (that dependent needs its prerequisite least). Repeats until
 * acyclic. Returns the surviving edges and what was removed.
 */
export function breakCycles(
  nodeIds: string[],
  edges: DagEdge[],
  priorityOf: (id: string) => Priority,
): { edges: DagEdge[]; removed: BrokenEdge[] } {
  const kept = [...edges];
  const removed: BrokenEdge[] = [];

  // Bound the loop by edge count; each iteration removes at least one edge.
  for (let guard = 0; guard <= edges.length; guard++) {
    const cycle = findCycle(nodeIds, kept);
    if (!cycle) break;

    // Consider the edges that form the cycle (consecutive pairs, wrapping).
    const cycleEdges: DagEdge[] = cycle.map((from, i) => ({
      from,
      to: cycle[(i + 1) % cycle.length]!,
    }));
    // Remove the one whose destination has the lowest priority; tie → last.
    let victim = cycleEdges[0]!;
    let lowest = PRIORITY_WEIGHT[priorityOf(victim.to)];
    for (const e of cycleEdges) {
      const w = PRIORITY_WEIGHT[priorityOf(e.to)];
      if (w <= lowest) {
        lowest = w;
        victim = e;
      }
    }
    const idx = kept.findIndex(
      (e) => e.from === victim.from && e.to === victim.to,
    );
    if (idx === -1) break; // safety
    kept.splice(idx, 1);
    removed.push({
      ...victim,
      reason: `broke cycle ${cycle.join(" → ")} by dropping the prerequisite edge into the lowest-priority node`,
    });
  }

  return { edges: kept, removed };
}
