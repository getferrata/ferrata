import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { decideFigure, figureBytes } from "@/lib/sources/figures";

export const runtime = "nodejs";

/**
 * GET: the bytes of one figure. POST: the author's decision about it.
 *
 * Served from here rather than written into public/, and that is the whole
 * point of the route existing. A file under public/ is readable by anybody who
 * can guess its name, and these are pictures out of somebody's internal
 * documents: an architecture diagram, a screenshot of a console, a photograph
 * of a whiteboard. The same access rule as the course they belong to, checked
 * on every request.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; figureId: string }> },
): Promise<NextResponse | Response> {
  const { id, figureId } = await params;
  const user = await requireUser();
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) {
    // Not 403: whether a course exists is itself something a stranger does not
    // get to learn, and the same goes for its pictures.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const fig = figureBytes(id, figureId);
  if (!fig) return NextResponse.json({ error: "not found" }, { status: 404 });

  // A student sees a figure only once the author has approved it. Until then it
  // is a picture out of an internal document that nobody has looked at, and the
  // reason this feature has an approval step at all is that images walk past
  // the scanner that catches secrets in text.
  if (fig.status !== "approved" && user.role !== "examiner") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new Response(new Uint8Array(fig.data), {
    headers: {
      "content-type": fig.mime,
      "content-length": String(fig.data.length),
      // Private: it is behind a login and belongs to one course.
      "cache-control": "private, max-age=3600",
      // The bytes came out of somebody's upload. Never let a browser decide
      // they are something more interesting than an image.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; figureId: string }> },
): Promise<NextResponse> {
  const { id, figureId } = await params;
  const user = await requireUser();
  if (user.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as {
    status?: unknown;
  } | null;
  const status = body?.status;
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json(
      { error: "status must be approved or rejected" },
      { status: 400 },
    );
  }
  if (!decideFigure(id, figureId, status, user.id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status });
}
