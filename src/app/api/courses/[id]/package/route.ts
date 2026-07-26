import { NextResponse } from "next/server";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { getCourseBundle } from "@/lib/course/query";
import { buildPackage } from "@/lib/package/format";
import { slug, writePackage } from "@/lib/package/export";
import { newId, now } from "@/lib/util/id";
import { getCurrentUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";

export const runtime = "nodejs";

/**
 * GET /api/courses/:id/package: download the portable single-file `.ferrata.json`
 * as a browser attachment. This is the primary export: it works for a served,
 * multi-user install where a server-side file path would be unreachable. Records
 * a trusted `packages` row as the provenance ledger.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // The package carries the whole course. Signing in is the minimum, and a
  // student only gets the courses they were actually assigned.
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!canSeeCourse(id, { userId: me.id, role: me.role })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const bundle = getCourseBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (bundle.course.status !== "ready") {
    return NextResponse.json({ error: "course not ready" }, { status: 409 });
  }

  const pkg = buildPackage(bundle, {
    author: null,
    license: null,
    exportedAt: now(),
  });
  db.insert(packages)
    .values({
      id: newId("pkg"),
      courseId: bundle.course.id,
      manifestJson: JSON.stringify(pkg.manifest),
      sourceHash: pkg.manifest.sourceHash,
      trusted: true,
    })
    .run();

  const filename = `${slug(bundle.course.title)}.ferrata.json`;
  return new NextResponse(JSON.stringify(pkg, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * POST /api/courses/:id/package: also write the diffable directory layout to the
 * server's `exports/` dir (useful for a local install / tooling). Returns paths.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // The package carries the whole course. Signing in is the minimum, and a
  // student only gets the courses they were actually assigned.
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!canSeeCourse(id, { userId: me.id, role: me.role })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const bundle = getCourseBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (bundle.course.status !== "ready") {
    return NextResponse.json({ error: "course not ready" }, { status: 409 });
  }
  const result = await writePackage(bundle);
  return NextResponse.json(result, { status: 201 });
}
