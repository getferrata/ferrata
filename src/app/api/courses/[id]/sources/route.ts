import { NextResponse } from "next/server";
import { cappedFormData } from "@/lib/http/body";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { ingestSource, type IngestResult } from "@/lib/sources/ingest";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // same ceiling as course creation
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // whole request, checked before parsing
const MAX_FILES = 20;

/**
 * POST /api/courses/:id/sources: add material to a FINISHED course.
 *
 * The material goes through the same DLP gate as at creation, at the level
 * chosen for this course. Then a model pass reads it against the course and
 * stores proposals: what to update, what to add, what to retire. Nothing is
 * applied here; a course that rewrote itself when a file landed would be a
 * course the author no longer knows the contents of.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  if (course.status !== "ready") {
    return NextResponse.json(
      { error: "the course is still being built" },
      { status: 409 },
    );
  }

  // Counted off the stream, not taken from Content-Length: that header is
  // absent under chunked encoding and unverified when present, so a cap built
  // on it is skipped by anyone who omits it.
  const parsed = await cappedFormData(req, MAX_TOTAL_BYTES);
  if (!parsed.ok) {
    return parsed.reason === "too_large"
      ? NextResponse.json({ error: "upload too large" }, { status: 413 })
      : NextResponse.json(
          { error: "expected multipart form" },
          { status: 400 },
        );
  }
  const form = parsed.form;

  const mode = course.contextiaMode ?? undefined;
  const results: IngestResult[] = [];

  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File)
    .slice(0, MAX_FILES);
  for (const file of files) {
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    results.push(
      await ingestSource(
        id,
        { kind: "file", name: file.name, mime: file.type || null, buf },
        mode,
      ),
    );
  }

  const text = String(form.get("text") ?? "").trim();
  if (text) {
    results.push(
      await ingestSource(id, { kind: "text", name: "added notes", text }, mode),
    );
  }

  const urls = String(form.get("urls") ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 10);
  for (const url of urls) {
    results.push(await ingestSource(id, { kind: "url", url }, mode));
  }

  if (results.length === 0) {
    return NextResponse.json(
      { error: "attach a file, paste text, or give a link" },
      { status: 400 },
    );
  }

  // Only what actually yielded text can be read against the course. A source
  // Contextia blocked, or a dead link, shows up in the material list with its
  // reason; it does not silently become an empty analysis.
  const usable = results.filter((r) => r.ok).map((r) => r.sourceId);
  if (usable.length > 0) {
    enqueue("propose_updates", {
      courseId: id,
      sourceIds: usable,
      actorUserId: me.id,
    });
  }

  return NextResponse.json(
    {
      sources: results.map((r) => ({ name: r.name, ok: r.ok, error: r.error ?? null })),
      queued: usable.length > 0,
    },
    { status: 201 },
  );
}
