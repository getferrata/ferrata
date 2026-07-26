import { NextResponse } from "next/server";
import { getCourseBundle } from "@/lib/course/query";
import { writeVault } from "@/lib/export/obsidian";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/** POST /api/courses/:id/export: write an Obsidian vault to ./exports/<slug>. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // Writes the whole course to disk on the server: examiners, own course only.
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const bundle = getCourseBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (bundle.course.ownerId && bundle.course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  if (bundle.course.status !== "ready") {
    return NextResponse.json(
      { error: "course not ready" },
      { status: 409 },
    );
  }
  const { path, fileCount } = await writeVault(bundle);
  return NextResponse.json({ path, fileCount }, { status: 201 });
}
