import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getLogger } from "@/lib/log";

const log = getLogger("trace");

/**
 * What was asked and what came back, when somebody turns it on.
 *
 * The ledger records what every call cost, how long it took and why it was
 * thrown away, and nothing at all about its content. That is enough to answer
 * "what did this course cost" and useless for the question that actually comes
 * up: the plan says the opposite of what the author asked for, so was the
 * instruction never put in the prompt, put in and not understood, or understood
 * and overruled? Three causes, three different fixes, and from the outside they
 * look identical.
 *
 * Off unless FERRATA_TRACE_DIR names a directory, and on disk rather than in
 * the database on purpose. A prompt carries the material: in the database it
 * would land in every backup, every export and every copy of the file somebody
 * takes, and a person who turned on a debugging aid has not agreed to that. On
 * disk it sits in one directory they chose, and deleting it is deleting it.
 *
 * Contextia runs before any of this, so what is written here is what was really
 * sent, protected values already replaced by their placeholders. It is not a
 * way around the scrubbing, and it is not a way to see what the scrubbing hid.
 */

export interface TraceEntry {
  task: string;
  provider: string;
  model: string;
  courseId: string | null;
  userId: string | null;
  /** Which try this was: a repair loop writes one entry per attempt. */
  attempt: number;
  system: string;
  messages: { role: string; content: string }[];
  response: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ok: boolean;
  /** Why it was discarded, matching the ledger's own column. */
  reason: string | null;
  at: number;
}

/** The directory to write into, or null when tracing is off. */
export function traceDir(): string | null {
  const raw = process.env.FERRATA_TRACE_DIR?.trim();
  return raw ? resolve(raw) : null;
}

/** Whether anything at all should be written. Cheap enough to call per attempt. */
export function tracing(): boolean {
  return traceDir() !== null;
}

/**
 * One line of JSON per attempt, appended to a file per course.
 *
 * A file per course rather than per call because the question is almost always
 * about one course, and reading it should not mean sorting several hundred
 * files by name. Appending rather than rewriting because generation runs in
 * parallel and a read-modify-write would lose entries.
 */
export function traceCall(entry: TraceEntry): void {
  const dir = traceDir();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${entry.courseId ?? "no-course"}.jsonl`);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    // Never worth interrupting a course for. A trace that cannot be written is
    // a missing diagnostic, not a failed build, and the one thing that must not
    // happen is a debugging aid taking down the thing being debugged.
    log.warn(
      `could not write trace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
