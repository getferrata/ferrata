import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-watch-")),
  "test.db",
);

const fetchUrlText = vi.fn();
vi.mock("@/lib/sources/url", () => ({ fetchUrlText }));

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const {
  courses: coursesT,
  sourceChunks: chunksT,
  sources: sourcesT,
} = await import("@/db/schema");
const {
  hashSourceText,
  sourceCheckDays,
  sourceCheckIsDue,
  sweepSources,
  watchableSources,
  SOURCE_CHECK_KEY,
} = await import("@/lib/sources/watch");
const { newId } = await import("@/lib/util/id");
type CourseStatus = typeof coursesT.$inferInsert.status;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function seedCourse(status: CourseStatus = "ready"): string {
  const id = newId("course");
  db.insert(coursesT)
    .values({
      id,
      title: "Course",
      sourcePrompt: "brief",
      lang: "en",
      status,
      ownerId: null,
    })
    .run();
  return id;
}

function seedSource(
  courseId: string,
  opts: {
    kind?: "url" | "file" | "text";
    status?: "ok" | "failed";
    text?: string;
    checkedAt?: number | null;
    hash?: string | null;
  } = {},
): string {
  const id = newId("src");
  const text = opts.text ?? "the page as it was";
  db.insert(sourcesT)
    .values({
      id,
      courseId,
      kind: opts.kind ?? "url",
      name: `https://wiki.example/${id}`,
      status: opts.status ?? "ok",
      textLen: text.length,
      contentHash:
        opts.hash === undefined ? hashSourceText(text) : opts.hash,
      checkedAt: opts.checkedAt ?? null,
    })
    .run();
  db.insert(chunksT)
    .values({ id: newId("chunk"), sourceId: id, courseId, ord: 0, text })
    .run();
  return id;
}

const chunksFor = (sourceId: string): string[] =>
  db
    .select({ text: chunksT.text })
    .from(chunksT)
    .where(eq(chunksT.sourceId, sourceId))
    .all()
    .map((c) => c.text);

beforeEach(() => {
  db.delete(chunksT).run();
  db.delete(sourcesT).run();
  db.delete(coursesT).run();
  fetchUrlText.mockReset();
  process.env[SOURCE_CHECK_KEY] = "7";
});

describe("the schedule", () => {
  it("is off unless somebody sets it", () => {
    delete process.env[SOURCE_CHECK_KEY];
    expect(sourceCheckDays()).toBe(0);
    // Off by default on purpose: this one makes outbound requests to other
    // people's servers on a timer, which is the operator's call.
    seedSource(seedCourse());
    expect(watchableSources(NOW)).toHaveLength(0);
  });

  it("ignores junk rather than falling into a tight loop", () => {
    for (const bad of ["0", "-3", "soon", ""]) {
      process.env[SOURCE_CHECK_KEY] = bad;
      expect(sourceCheckDays()).toBe(0);
    }
  });

  it("waits out the interval before re-reading a source", () => {
    const course = seedCourse();
    seedSource(course, { checkedAt: NOW - 2 * DAY });
    expect(sourceCheckIsDue(NOW)).toBe(false);
    expect(sourceCheckIsDue(NOW + 6 * DAY)).toBe(true);
  });

  it("takes a never-checked source straight away", () => {
    seedSource(seedCourse(), { checkedAt: null });
    expect(sourceCheckIsDue(NOW)).toBe(true);
  });

  it("reads the least recently checked first", () => {
    const course = seedCourse();
    const older = seedSource(course, { checkedAt: NOW - 90 * DAY });
    seedSource(course, { checkedAt: NOW - 30 * DAY });
    expect(watchableSources(NOW)[0]!.id).toBe(older);
  });
});

describe("what is watchable", () => {
  it("leaves alone what it could not re-read anyway", () => {
    // An uploaded file is stored as its extracted text, never its bytes, so
    // there is nothing to fetch again and nothing to compare.
    const course = seedCourse();
    seedSource(course, { kind: "file" });
    seedSource(course, { kind: "text" });
    expect(watchableSources(NOW)).toHaveLength(0);
  });

  it("leaves a course that is still building alone", () => {
    // Proposals against a course whose modules are still being written are
    // noise, and the build has enough going on.
    seedSource(seedCourse("generating"));
    expect(watchableSources(NOW)).toHaveLength(0);
  });

  it("skips a source that failed to ingest in the first place", () => {
    seedSource(seedCourse(), { status: "failed" });
    expect(watchableSources(NOW)).toHaveLength(0);
  });

  it("skips a source ingested before hashing existed", () => {
    // Nothing to compare against: re-reading it would report a change on the
    // first sweep whether or not anything moved.
    seedSource(seedCourse(), { hash: null });
    expect(watchableSources(NOW)).toHaveLength(0);
  });
});

describe("a sweep", () => {
  it("reports nothing when the page is byte for byte the same", async () => {
    const course = seedCourse();
    const id = seedSource(course, { text: "unchanged" });
    fetchUrlText.mockResolvedValue({ ok: true, text: "unchanged" });

    const out = await sweepSources(NOW, 0);
    expect(out).toMatchObject({ checked: 1, changed: 0 });
    expect(out.byCourse.size).toBe(0);
    // Still recorded as looked at, or it would be re-read on every sweep.
    const row = db.select().from(sourcesT).where(eq(sourcesT.id, id)).get();
    expect(row?.checkedAt).not.toBeNull();
  });

  it("replaces the material and names the course when the page moved", async () => {
    const course = seedCourse();
    const id = seedSource(course, { text: "the old runbook" });
    fetchUrlText.mockResolvedValue({
      ok: true,
      text: "the runbook, with the new rollback step",
    });

    const out = await sweepSources(NOW, 0);
    expect(out.changed).toBe(1);
    expect(out.byCourse.get(course)).toEqual([id]);
    expect(chunksFor(id).join(" ")).toContain("rollback");
    const row = db.select().from(sourcesT).where(eq(sourcesT.id, id)).get();
    expect(row?.contentHash).toBe(
      hashSourceText("the runbook, with the new rollback step"),
    );
  });

  it("does not report a page that is merely down as a change", async () => {
    // A link that 500s or has moved behind a login has not changed the course.
    // Reporting it would queue a paid proposal run over nothing.
    const course = seedCourse();
    const id = seedSource(course, { text: "still here" });
    fetchUrlText.mockResolvedValue({ ok: false, error: "502" });

    const out = await sweepSources(NOW, 0);
    expect(out).toMatchObject({ changed: 0, unreachable: 1 });
    expect(out.byCourse.size).toBe(0);
    expect(chunksFor(id)).toEqual(["still here"]);
    // Marked as looked at even so, or one dead link sits at the head of the
    // queue and is retried first on every sweep for ever.
    const row = db.select().from(sourcesT).where(eq(sourcesT.id, id)).get();
    expect(row?.checkedAt).not.toBeNull();
  });

  it("keeps the old material when the new text is empty", async () => {
    const course = seedCourse();
    const id = seedSource(course, { text: "the real page" });
    fetchUrlText.mockResolvedValue({ ok: true, text: "   " });

    const out = await sweepSources(NOW, 0);
    expect(out.changed).toBe(0);
    expect(chunksFor(id)).toEqual(["the real page"]);
  });

  it("does not re-read the same source twice in one sweep", async () => {
    const course = seedCourse();
    seedSource(course, { text: "a" });
    seedSource(course, { text: "b" });
    fetchUrlText.mockResolvedValue({ ok: true, text: "same" });

    await sweepSources(NOW, 0);
    expect(fetchUrlText).toHaveBeenCalledTimes(2);
    const urls = fetchUrlText.mock.calls.map((c) => c[0] as string);
    expect(new Set(urls).size).toBe(2);
  });

  it("groups several changed sources under their own courses", async () => {
    const a = seedCourse();
    const b = seedCourse();
    const a1 = seedSource(a, { text: "old a1" });
    const a2 = seedSource(a, { text: "old a2" });
    const b1 = seedSource(b, { text: "old b1" });
    fetchUrlText.mockResolvedValue({ ok: true, text: "new text" });

    const out = await sweepSources(NOW, 0);
    expect(out.changed).toBe(3);
    expect(out.byCourse.get(a)?.sort()).toEqual([a1, a2].sort());
    expect(out.byCourse.get(b)).toEqual([b1]);
  });
});
