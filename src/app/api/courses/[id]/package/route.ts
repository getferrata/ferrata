import { NextResponse } from "next/server";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { getCourseBundle } from "@/lib/course/query";
import { buildPackage } from "@/lib/package/format";
import { slug, writePackage } from "@/lib/package/export";
import { newId, now } from "@/lib/util/id";
import { getCurrentUser } from "@/lib/auth/session";

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
  // The package carries the whole course, answer keys included, so it is an
  // authoring artifact, not a study one: examiner, own course only. Letting an
  // enrolled student export it would hand them the answer key an assessed course
  // deliberately withholds from the page and the review API.
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
  // Writes the whole course, answer keys included, to the server's disk:
  // examiner, own course only, same as the download above.
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
    return NextResponse.json({ error: "course not ready" }, { status: 409 });
  }
  const result = await writePackage(bundle);
  return NextResponse.json(result, { status: 201 });
}
