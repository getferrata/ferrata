import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts } from "@/db/schema";
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
  const { conceptId } = await params;
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
    .where(eq(concepts.id, conceptId))
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
