import type { Priority } from "@/db/schema";
import { PRIORITY_WEIGHT, type DagEdge } from "./dag";

export interface TriageConcept {
  id: string;
  title: string;
  priority: Priority;
  estimatedMinutes: number;
}

export interface TriageCut {
  id: string;
  title: string;
  reason: string;
}

export interface TriageResult {
  survivorIds: string[];
  cuts: TriageCut[];
  /** True if the survivors fit the budget (or no budget was set). */
  feasible: boolean;
  totalMinutes: number;
  budgetMinutes: number | null;
}

/**
 * Cut the plan to fit the time budget:
 *  - only terminal concepts (nothing surviving depends on them) are removable:
 *    a prerequisite of a survivor is never cut;
 *  - remove lowest-priority first; critical/high goals are never auto-cut;
 *  - if it cannot fit without cutting a protected node, declare it infeasible
 *    instead of silently compressing.
 */
export function triage(
  concepts: TriageConcept[],
  edges: DagEdge[],
  budgetMinutes: number | null,
): TriageResult {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const survivors = new Set(concepts.map((c) => c.id));
  const cuts: TriageCut[] = [];

  const total = () =>
    [...survivors].reduce((s, id) => s + (byId.get(id)?.estimatedMinutes ?? 0), 0);

  if (budgetMinutes === null) {
    return {
      survivorIds: [...survivors],
      cuts,
      feasible: true,
      totalMinutes: total(),
      budgetMinutes,
    };
  }

  // A node is a prerequisite of a survivor if some edge points from it to a
  // surviving node. Such nodes are protected from cutting.
  const isNeededBySurvivor = (id: string): boolean =>
    edges.some((e) => e.from === id && survivors.has(e.to) && e.to !== id);

  while (total() > budgetMinutes) {
    const removable = [...survivors]
      .map((id) => byId.get(id))
      .filter((c): c is TriageConcept => Boolean(c))
      // terminal (nothing surviving needs it) and not a protected goal
      .filter((c) => !isNeededBySurvivor(c.id))
      .filter((c) => c.priority === "low" || c.priority === "medium");

    if (removable.length === 0) break; // cannot cut further without harm

    // Lowest priority first, then largest time (converge faster), then title.
    removable.sort(
      (a, b) =>
        PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] ||
        b.estimatedMinutes - a.estimatedMinutes ||
        a.title.localeCompare(b.title),
    );

    const victim = removable[0]!;
    survivors.delete(victim.id);
    cuts.push({
      id: victim.id,
      title: victim.title,
      reason: `priority ${victim.priority}, ${victim.estimatedMinutes} min: not a prerequisite of any kept module and doesn't fit the time budget.`,
    });
  }

  const totalMinutes = total();
  return {
    survivorIds: [...survivors],
    cuts,
    feasible: totalMinutes <= budgetMinutes,
    totalMinutes,
    budgetMinutes,
  };
}
