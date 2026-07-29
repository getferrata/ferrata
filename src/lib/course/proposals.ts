import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts,
  cuts,
  edges,
  proposals,
  questions,
  type Priority,
  type Proposal,
} from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { enqueueRegenerateModuleOnce } from "@/lib/jobs/queue";
import type { ProposalItem } from "@/lib/llm/tasks/propose_updates/schema";

/** add_concept payload as stored in payloadJson. */
export interface ConceptCandidate {
  title: string;
  summary: string;
  priority: Priority;
  estimatedMinutes: number;
  depthLevel: number;
}

/**
 * Store what the model proposed, resolving concept indexes against the list
 * the prompt actually showed. An index the model invented, or a kind whose
 * required parts are missing, is dropped rather than stored: a proposal the
 * author cannot act on is noise wearing a checklist's clothes.
 */
export function recordProposals(
  courseId: string,
  items: readonly ProposalItem[],
  conceptsShown: readonly { id: string; title: string }[],
): number {
  // One pending proposal per target. Guards three ways in: the job is retried
  // after a crash, the author can upload the same file twice, and a single
  // model response can name the same concept twice. The seen-set starts from
  // what is already pending and grows as we insert, so duplicates within this
  // batch are caught too, not just across calls.
  const seen = new Set(
    pendingProposals(courseId).map((p) =>
      p.conceptId ? `${p.kind}:${p.conceptId}` : `${p.kind}:${p.title}`,
    ),
  );
  const take = (kind: string, key: string): boolean => {
    const tag = `${kind}:${key}`;
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  };

  let stored = 0;
  for (const item of items) {
    if (item.kind === "add_concept") {
      if (!item.candidate) continue;
      if (!take("add_concept", item.candidate.title)) continue;
      db.insert(proposals)
        .values({
          id: newId("prop"),
          courseId,
          kind: "add_concept",
          conceptId: null,
          title: item.candidate.title,
          reason: item.reason,
          payloadJson: JSON.stringify(item.candidate),
        })
        .run();
      stored++;
      continue;
    }
    const target =
      item.conceptIndex !== null ? conceptsShown[item.conceptIndex] : undefined;
    if (!target) continue;
    if (!take(item.kind, target.id)) continue;
    db.insert(proposals)
      .values({
        id: newId("prop"),
        courseId,
        kind: item.kind,
        conceptId: target.id,
        title: target.title,
        reason: item.reason,
        payloadJson: null,
      })
      .run();
    stored++;
  }
  return stored;
}

export type ApplyResult =
  | { ok: true; effect: "queued_rewrite" | "queued_new_module" | "retired" }
  | { ok: false; error: string };

/**
 * Apply one approved proposal. Called from the decision endpoint, after the
 * author clicked approve; this function is where the click becomes real.
 *
 *  - update_module queues a rewrite of that concept through the quality loop,
 *    grounded on everything the course now has, new material included.
 *  - add_concept inserts the concept at the end of the path and queues its
 *    module. The prerequisite graph is not recomputed: a late addition hangs
 *    off the end rather than resequencing a course people are mid-way through.
 *  - retire_concept records the cut, with the reason, then retires the concept
 *    and its questions. Retired, not deleted: a delete would cascade into the
 *    answers people already gave, and the cut row is what the author sees while
 *    the record underneath it stays intact.
 */
export function applyProposal(
  proposal: Proposal,
  actorUserId: string,
): ApplyResult {
  if (proposal.kind === "update_module") {
    if (!proposal.conceptId) return { ok: false, error: "no concept" };
    const c = db
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(
          eq(concepts.id, proposal.conceptId),
          eq(concepts.courseId, proposal.courseId),
        ),
      )
      .get();
    if (!c) return { ok: false, error: "the concept no longer exists" };
    enqueueRegenerateModuleOnce(proposal.courseId, proposal.conceptId, actorUserId);
    return { ok: true, effect: "queued_rewrite" };
  }

  if (proposal.kind === "add_concept") {
    const candidate = parseCandidate(proposal.payloadJson);
    if (!candidate) return { ok: false, error: "the proposal is malformed" };
    const maxOrder =
      db
        .select({ m: sql<number | null>`max(${concepts.topoOrder})` })
        .from(concepts)
        .where(eq(concepts.courseId, proposal.courseId))
        .get()?.m ?? null;
    const conceptId = newId("concept");
    db.insert(concepts)
      .values({
        id: conceptId,
        courseId: proposal.courseId,
        title: candidate.title,
        summary: candidate.summary,
        priority: candidate.priority,
        estimatedMinutes: candidate.estimatedMinutes,
        depthLevel: candidate.depthLevel,
        topoOrder: (maxOrder ?? -1) + 1,
      })
      .run();
    enqueueRegenerateModuleOnce(proposal.courseId, conceptId, actorUserId);
    return { ok: true, effect: "queued_new_module" };
  }

  // retire_concept
  if (!proposal.conceptId) return { ok: false, error: "no concept" };
  const target = db
    .select()
    .from(concepts)
    .where(
      and(
        eq(concepts.id, proposal.conceptId),
        eq(concepts.courseId, proposal.courseId),
      ),
    )
    .get();
  if (!target) return { ok: false, error: "the concept no longer exists" };
  db.transaction((tx) => {
    tx.insert(cuts)
      .values({
        id: newId("cut"),
        courseId: proposal.courseId,
        conceptId: target.id,
        title: target.title,
        reason: proposal.reason,
      })
      .run();
    // The edges table carries no foreign key to concepts, so the prerequisite
    // arrows into and out of this concept must go explicitly or they survive
    // as arrows to a node that no longer exists.
    tx.delete(edges).where(eq(edges.fromConceptId, target.id)).run();
    tx.delete(edges).where(eq(edges.toConceptId, target.id)).run();
    // Retired, not deleted. Deleting cascades through modules and questions
    // into `reviews`, so approving this proposal would erase what every student
    // already answered about the concept. The proposal itself is written by a
    // model reading uploaded material, which is not a good enough provenance to
    // destroy somebody's record on. The cut list above is what the author sees;
    // the history stays underneath it.
    tx.update(concepts)
      .set({ retiredAt: now() })
      .where(eq(concepts.id, target.id))
      .run();
    tx.update(questions)
      .set({ retiredAt: now() })
      .where(
        and(eq(questions.conceptId, target.id), isNull(questions.retiredAt)),
      )
      .run();
  });
  return { ok: true, effect: "retired" };
}

function parseCandidate(json: string | null): ConceptCandidate | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<ConceptCandidate>;
    if (!v.title || !v.summary) return null;
    if (typeof v.estimatedMinutes !== "number" || typeof v.depthLevel !== "number") {
      return null;
    }
    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    if (!priorities.includes(v.priority as Priority)) return null;
    return v as ConceptCandidate;
  } catch {
    return null;
  }
}

/** Pending proposals for a course, oldest first, for the author's checklist. */
export function pendingProposals(courseId: string): Proposal[] {
  return db
    .select()
    .from(proposals)
    .where(and(eq(proposals.courseId, courseId), eq(proposals.status, "pending")))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Mark a decision. Returns the row only if it was still pending. */
export function decideProposal(
  proposalId: string,
  courseId: string,
  status: "approved" | "dismissed",
  userId: string,
): Proposal | null {
  const row = db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.courseId, courseId),
        eq(proposals.status, "pending"),
      ),
    )
    .get();
  if (!row) return null;
  db.update(proposals)
    .set({ status, decidedAt: now(), decidedBy: userId })
    .where(and(eq(proposals.id, proposalId), inArray(proposals.status, ["pending"])))
    .run();
  return row;
}
