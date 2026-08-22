import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Things that must be true of the database, whatever code path put it there.
 *
 * The unit tests check functions and the e2e checks journeys, and both are
 * arguments about code somebody wrote on purpose. These are arguments about
 * state: they do not care which route reached it, whether that route still
 * exists, or whether anyone remembered to test it. A handler added next year
 * that writes a ready module with no questions breaks this file without
 * anybody having thought to point it at the new handler.
 *
 * Each check is one query returning the rows that should not exist. Empty is
 * the pass. Written as SQL rather than through the ORM on purpose: the ORM is
 * part of what is being checked, and a query built from the same schema objects
 * the writer used would inherit any wrong assumption in them.
 */

export interface Invariant {
  name: string;
  /** Why this state is wrong, in terms of what it does to a person. */
  matters: string;
  sql: string;
}

export interface Violation {
  invariant: string;
  matters: string;
  count: number;
  sample: Record<string, unknown>[];
}

export const INVARIANTS: Invariant[] = [
  {
    name: "a module in a finished course always has a live test",
    matters:
      "The test is how this product knows anything was learned. A module without one is read, marked done, and measures nothing.",
    // Scoped to finished courses, and the scoping is the whole point. The first
    // version asked this of every ready module and found 184 on a development
    // database: 179 of them belonged to courses still generating, where a
    // written body waiting for its questions is the normal middle of a build
    // and exactly what the resume path is built to pick up. An invariant that
    // fires on correct transient state is not a strict invariant, it is a
    // broken one, and it trains whoever reads the output to ignore it.
    // Scoped to concept modules as well, and that scoping was earned by being
    // wrong. The hand-written course this pipeline is measured against ends with
    // two modules carrying no test, and the seed marks them method and meta
    // because that is what they are: how to troubleshoot, and how the interview
    // goes. Neither is measurable with a question about a fact. An invariant
    // contradicted by the output the product is measured against is describing a
    // rule the product does not have.
    sql: `
      SELECT m.id AS module_id, m.concept_id, c.course_id
      FROM modules m
      JOIN concepts c ON c.id = m.concept_id
      JOIN courses co ON co.id = c.course_id
      WHERE m.status = 'ready'
        AND m.kind = 'concept'
        AND co.status = 'ready'
        AND c.retired_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM questions q
          WHERE q.concept_id = m.concept_id AND q.retired_at IS NULL
        )
    `,
  },
  {
    name: "a ready course has a module for every concept it kept",
    matters:
      "A concept with no module is a gap in the path the student is told is complete.",
    sql: `
      SELECT c.id AS concept_id, c.course_id, c.title
      FROM concepts c
      JOIN courses co ON co.id = c.course_id
      WHERE co.status = 'ready'
        AND c.retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.concept_id = c.id)
    `,
  },
  {
    name: "no question outlives the concept it belongs to",
    matters:
      "An orphaned question can still be served for review, and it grades an answer against a module nobody can open.",
    sql: `
      SELECT q.id AS question_id, q.concept_id
      FROM questions q
      WHERE NOT EXISTS (SELECT 1 FROM concepts c WHERE c.id = q.concept_id)
    `,
  },
  {
    name: "no review points at a question that is gone",
    matters:
      "Reviews are the record of what somebody knew. One pointing nowhere is a hole in the only evidence this product produces.",
    sql: `
      SELECT r.id AS review_id, r.question_id
      FROM reviews r
      WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = r.question_id)
    `,
  },
  {
    name: "a review against a retired question still says what was asked",
    matters:
      "Retiring is the safe half of a rewrite because the answers survive it, but a surviving answer to wording nobody kept is unreadable: an examiner sees a wrong answer and cannot tell what the question was.",
    sql: `
      SELECT r.id AS review_id, r.question_id
      FROM reviews r
      JOIN questions q ON q.id = r.question_id
      WHERE q.retired_at IS NOT NULL
        AND (r.question_prompt IS NULL OR trim(r.question_prompt) = '')
    `,
  },
  {
    // The invariant that used to be here asked that every billed call name a
    // course that still exists. It found seventy rows across eight deleted
    // courses, and it was wrong: the ledger outlives the course on purpose,
    // because the money was spent whether or not the course was later thrown
    // away. Enforcing it would have meant deleting billing history to satisfy a
    // check. Left as a note because the near miss is the lesson: an invariant
    // that encodes an assumption the product deliberately does not hold is
    // worse than no invariant, and the only thing between the two is looking at
    // what it found before believing it.
    name: "the credits charged match the cost recorded",
    matters:
      "Credits are what the spend ceiling counts and dollars are what the receipt shows. If they drift apart, one of the two numbers is lying and nothing says which.",
    sql: `
      SELECT id AS call_id, cost_usd, credits
      FROM llm_calls
      WHERE cost_usd > 0
        AND credits <> CAST(cost_usd * 100 AS INTEGER) + (CASE WHEN cost_usd * 100 > CAST(cost_usd * 100 AS INTEGER) THEN 1 ELSE 0 END)
    `,
  },
  {
    name: "cached tokens never exceed the prompt they came from",
    matters:
      "tokensIn carries the cached spans, so cached-greater-than-total means the ledger is pricing a negative number of tokens and inventing a discount.",
    sql: `
      SELECT id AS call_id, tokens_in, cache_read_tokens, cache_write_tokens
      FROM llm_calls
      WHERE cache_read_tokens + cache_write_tokens > tokens_in
    `,
  },
  {
    name: "a figure belongs to a source of its own course",
    matters:
      "A picture out of one company's documents, served under another company's course, is the leak this whole approval step exists to prevent.",
    sql: `
      SELECT f.id AS figure_id, f.course_id, f.source_id
      FROM figures f
      JOIN sources s ON s.id = f.source_id
      WHERE s.course_id <> f.course_id
    `,
  },
  {
    name: "a decided figure records who decided it",
    matters:
      "Approving a picture is the moment somebody takes responsibility for what is in it. A decision with nobody's name on it is not a record, and the next person cannot tell whether it was looked at or defaulted.",
    sql: `
      SELECT id AS figure_id, status, decided_at, decided_by
      FROM figures
      WHERE status <> 'pending'
        AND (decided_by IS NULL OR trim(decided_by) = '' OR decided_at IS NULL)
    `,
  },
  {
    name: "a figure that is still pending has not been decided",
    matters:
      "The other direction, and it is what a mistaken bulk update looks like: a row carrying a decider while still queued for a decision means the queue is lying about what is waiting.",
    sql: `
      SELECT id AS figure_id, decided_by
      FROM figures
      WHERE status = 'pending' AND (decided_by IS NOT NULL OR decided_at IS NOT NULL)
    `,
  },
  {
    name: "no figure is stored without bytes",
    matters:
      "An empty picture is asked about, approved, embedded in a module and exported, and it is a broken image everywhere it lands.",
    sql: `
      SELECT id AS figure_id, bytes
      FROM figures
      WHERE bytes <= 0 OR length(data) = 0
    `,
  },
  {
    name: "a figure's hash is the one its token is built from",
    matters:
      "The token in a module body is the first twelve characters of this hash. A malformed one is a picture nothing can ever point at: stored, approved, and unreachable.",
    sql: `
      SELECT id AS figure_id, sha256
      FROM figures
      WHERE length(sha256) <> 64 OR sha256 GLOB '*[^0-9a-f]*'
    `,
  },
  {
    name: "no source chunk is empty",
    matters:
      "An empty chunk grounds nothing, takes a slot in retrieval, and can be handed to a model as an excerpt of the material.",
    sql: `
      SELECT id AS chunk_id, source_id
      FROM source_chunks
      WHERE trim(text) = ''
    `,
  },
  {
    name: "no chunk belongs to a source that is gone",
    matters:
      "The course would be grounded on, and cite, material nothing can trace back to a document.",
    sql: `
      SELECT ch.id AS chunk_id, ch.source_id
      FROM source_chunks ch
      WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = ch.source_id)
    `,
  },
  {
    name: "a course belongs to somebody, or to nobody on purpose",
    matters:
      "A course pointing at a deleted user is a course nobody can administer and whose spend lands on an account that does not exist.",
    sql: `
      SELECT c.id AS course_id, c.owner_id
      FROM courses c
      WHERE c.owner_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id)
    `,
  },
  {
    name: "no concept survives the course it was planned for",
    matters:
      "Orphaned concepts are counted by anything that walks the plan, so a deleted course goes on inflating totals.",
    sql: `
      SELECT c.id AS concept_id, c.course_id
      FROM concepts c
      WHERE NOT EXISTS (SELECT 1 FROM courses co WHERE co.id = c.course_id)
    `,
  },
  {
    name: "a module's concept order is unique within its course",
    matters:
      "Two concepts sharing a position make the path's order arbitrary, and the student is walked through prerequisites in whichever order the query happened to return.",
    sql: `
      SELECT course_id, topo_order, count(*) AS n
      FROM concepts
      WHERE topo_order IS NOT NULL AND retired_at IS NULL
      GROUP BY course_id, topo_order
      HAVING count(*) > 1
    `,
  },
];

/**
 * Run every invariant and return the ones that are broken.
 *
 * Read-only by construction: each check is a SELECT, so this is safe to point
 * at a live database, and safe to run in a loop.
 */
export function checkInvariants(only?: string[]): Violation[] {
  const wanted = only?.length
    ? INVARIANTS.filter((i) => only.includes(i.name))
    : INVARIANTS;

  const out: Violation[] = [];
  for (const inv of wanted) {
    const rows = db.all<Record<string, unknown>>(sql.raw(inv.sql));
    if (rows.length > 0) {
      out.push({
        invariant: inv.name,
        matters: inv.matters,
        count: rows.length,
        // A handful is enough to find the cause; the count says how bad it is.
        sample: rows.slice(0, 5),
      });
    }
  }
  return out;
}

/** The violations as something a person can read in a terminal. */
export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) {
    return `All ${INVARIANTS.length} invariants hold.`;
  }
  const lines = [
    `${violations.length} of ${INVARIANTS.length} invariants are broken.`,
    "",
  ];
  for (const v of violations) {
    lines.push(`✗ ${v.invariant}`);
    lines.push(`  ${v.count} row(s). ${v.matters}`);
    for (const row of v.sample) {
      lines.push(`    ${JSON.stringify(row)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
