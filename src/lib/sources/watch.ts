import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { courses, restorations, sourceChunks, sources } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { getLogger } from "@/lib/log";
import { newId, now } from "@/lib/util/id";
import { sealSecret } from "@/lib/crypto/secrets";
import { chunkSource } from "./chunk";
import { fetchUrlText } from "./url";
import { scanSensitivity } from "./dlp";

const log = getLogger("sources");

/**
 * Noticing that the material moved.
 *
 * A course is built from documents that go on being edited after the build. The
 * runbook gains a step, the wiki page is corrected, the policy changes: the
 * course keeps teaching what the page said the day it was read, and nothing
 * says otherwise. This is the job that re-reads the sources and, where one has
 * changed, hands the new text to the machinery that already exists for it, so
 * the author sees the change as proposals to approve rather than as a course
 * that silently rewrote itself.
 */

export const SOURCE_CHECK_KEY = "FERRATA_SOURCE_CHECK_DAYS";

/** Pause between fetches, so a scheduled sweep is not a burst at somebody's wiki. */
const POLITE_GAP_MS = 2_000;

/** Sources re-read per sweep, so one run cannot become an unbounded crawl. */
const MAX_PER_SWEEP = 25;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** sha256 of the text as fetched. */
export function hashSourceText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * How often to re-read the sources, in days. Zero, unset or nonsense means
 * never.
 *
 * Off unless an operator asks for it, unlike the backup schedule, and for a
 * reason that is not timidity: this one makes outbound requests to somebody
 * else's servers on a timer. Backups write to a local disk the operator already
 * owns. Turning a product into a polite but unrequested crawler is the
 * operator's decision to make, not a default to inherit.
 */
export function sourceCheckDays(): number {
  const raw = getSetting(SOURCE_CHECK_KEY) ?? process.env[SOURCE_CHECK_KEY];
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface WatchedSource {
  id: string;
  courseId: string;
  name: string;
  contentHash: string | null;
  checkedAt: number | null;
}

/**
 * Sources a check could actually re-read, oldest check first.
 *
 * Only linked pages qualify today, and the reason is worth stating plainly
 * rather than discovering later: an uploaded file is stored as the text pulled
 * out of it, never the bytes, and a file read from a local repository keeps the
 * path it had relative to a root the source row does not record. Neither can be
 * fetched again from what is in the database, so neither can be compared. What
 * changes under you without telling you is the wiki page anyway.
 *
 * Restricted to ready courses: a build in flight has enough going on, and a
 * proposal against a course that does not exist yet is noise.
 */
export function watchableSources(at: number = Date.now()): WatchedSource[] {
  const days = sourceCheckDays();
  if (days === 0) return [];
  const due = at - days * 24 * 60 * 60 * 1000;

  return db
    .select({
      id: sources.id,
      courseId: sources.courseId,
      name: sources.name,
      contentHash: sources.contentHash,
      checkedAt: sources.checkedAt,
    })
    .from(sources)
    .innerJoin(courses, eq(courses.id, sources.courseId))
    .where(
      and(
        eq(sources.kind, "url"),
        eq(sources.status, "ok"),
        eq(courses.status, "ready"),
        isNotNull(sources.contentHash),
      ),
    )
    .orderBy(asc(sources.checkedAt))
    .all()
    .filter((s) => (s.checkedAt ?? 0) <= due)
    .slice(0, MAX_PER_SWEEP);
}

/** True when at least one source is old enough to be worth re-reading. */
export function sourceCheckIsDue(at: number = Date.now()): boolean {
  return watchableSources(at).length > 0;
}

/**
 * Replace what a source contributes to the course with its new text.
 *
 * The re-read text is imported material like any other, so it goes back through
 * the redaction gate rather than around it: a secret that appeared in the page
 * this week must not reach a prompt just because the page was clean when the
 * author first attached it.
 */
function replaceChunks(
  source: WatchedSource,
  text: string,
  hash: string,
): Promise<number> {
  return scanSensitivity(text, source.name).then((scan) => {
    const safeText = scan.text.trim();
    if (scan.blocked || safeText.length === 0) {
      // Leave the old chunks in place. A page that now trips the gate is a
      // thing to tell the operator about, not a reason to quietly empty the
      // material a finished course is grounded on.
      log.warn(
        `source "${source.name}" changed but the new text is not usable (${scan.blocked ? "blocked by Contextia" : "no text"}); keeping what the course already had`,
      );
      return 0;
    }

    // Split the way it was first ingested: a source re-read after it changed
    // must not silently switch from code chunks back to prose ones, which
    // would make the same file retrieve differently before and after an edit.
    const chunks = chunkSource(safeText, source.name);
    db.transaction((tx) => {
      tx.delete(sourceChunks).where(eq(sourceChunks.sourceId, source.id)).run();
      for (const c of chunks) {
        tx.insert(sourceChunks)
          .values({
            id: newId("chunk"),
            sourceId: source.id,
            courseId: source.courseId,
            ord: c.ord,
            text: c.text,
          })
          .run();
      }
      for (const r of scan.restorations) {
        tx.insert(restorations)
          .values({
            id: newId("cxt"),
            courseId: source.courseId,
            token: r.token,
            value: sealSecret(r.value),
            label: r.label,
            type: r.type,
          })
          .run();
      }
      tx.update(sources)
        .set({
          contentHash: hash,
          textLen: safeText.length,
          checkedAt: now(),
          sensitivityJson: scan.verdict ? JSON.stringify(scan.verdict) : null,
        })
        .where(eq(sources.id, source.id))
        .run();
    });
    return chunks.length;
  });
}

/** Mark a source as looked at without changing what it contributes. */
function touch(id: string): void {
  db.update(sources).set({ checkedAt: now() }).where(eq(sources.id, id)).run();
}

export interface SweepResult {
  checked: number;
  changed: number;
  unreachable: number;
  /** Course id to the sources that moved, which is what a proposal needs. */
  byCourse: Map<string, string[]>;
}

/**
 * Re-read every source that is due, and report which ones moved.
 *
 * Deliberately does not queue anything itself. Deciding what to do about a
 * changed source is the caller's business, and keeping that out of here is what
 * makes this callable from a test without a job queue attached.
 */
export async function sweepSources(
  at: number = Date.now(),
  /** Overridable so a test does not have to sit through the politeness. */
  gapMs: number = POLITE_GAP_MS,
): Promise<SweepResult> {
  const due = watchableSources(at);
  const result: SweepResult = {
    checked: 0,
    changed: 0,
    unreachable: 0,
    byCourse: new Map(),
  };

  for (const [i, source] of due.entries()) {
    // Between fetches, not before the first: a sweep of one source should not
    // sit still for two seconds to be polite to nobody.
    if (i > 0 && gapMs > 0) await sleep(gapMs);

    const res = await fetchUrlText(source.name);
    result.checked++;
    if (!res.ok || !res.text) {
      // A page that is down, moved or newly behind a login is not a change to
      // the course. Recorded as looked-at so one broken link cannot hold up the
      // queue on every sweep from here on.
      result.unreachable++;
      touch(source.id);
      log.warn(
        `source "${source.name}" could not be re-read: ${res.error ?? "no text"}`,
      );
      continue;
    }

    const hash = hashSourceText(res.text);
    if (hash === source.contentHash) {
      touch(source.id);
      continue;
    }

    const chunks = await replaceChunks(source, res.text, hash);
    if (chunks === 0) {
      touch(source.id);
      continue;
    }

    result.changed++;
    const forCourse = result.byCourse.get(source.courseId) ?? [];
    forCourse.push(source.id);
    result.byCourse.set(source.courseId, forCourse);
    log.info(`source "${source.name}" changed; ${chunks} chunk(s) replaced`);
  }

  return result;
}
