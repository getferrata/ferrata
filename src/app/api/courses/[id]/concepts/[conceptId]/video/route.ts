import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses } from "@/db/schema";
import { isVideoEnabled, parseRefs, parseYouTubeId } from "@/lib/video";

import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

interface Body {
  url?: unknown;
  title?: unknown;
}

/** POST: attach a YouTube video to a concept (local-only, gated). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; conceptId: string }> },
): Promise<NextResponse> {
  if (!isVideoEnabled()) {
    return NextResponse.json({ error: "video disabled" }, { status: 403 });
  }
  // Attaching a video changes what a course teaches, so it is an author action:
  // examiner, own course, and the concept must belong to THIS course (the id in
  // the path was previously ignored, letting any concept be written by id alone).
  const { id, conceptId } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const url = typeof body.url === "string" ? body.url : "";
  const title = typeof body.title === "string" ? body.title : undefined;

  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return NextResponse.json({ error: "not a YouTube URL" }, { status: 400 });
  }

  const concept = db
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, conceptId), eq(concepts.courseId, id)))
    .get();
  if (!concept) {
    return NextResponse.json({ error: "concept not found" }, { status: 404 });
  }

  const refs = parseRefs(concept.videoRefsJson);
  if (!refs.some((r) => r.videoId === videoId)) {
    refs.push({ videoId, url, title });
  }
  db.update(concepts)
    .set({ videoRefsJson: JSON.stringify(refs) })
    .where(eq(concepts.id, conceptId))
    .run();

  return NextResponse.json({ refs }, { status: 201 });
}
