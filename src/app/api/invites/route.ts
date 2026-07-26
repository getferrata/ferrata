import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createInvite, revokeInvite } from "@/lib/course/invite";

export const runtime = "nodejs";

const schema = z.object({
  role: z.enum(["student", "examiner"]).default("student"),
});

/**
 * POST /api/invites: an examiner mints an account invite. This is how someone
 * becomes an author, since nobody can hand themselves that role by registering.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const token = createInvite({ role: parsed.data.role, createdBy: me.id });
  return NextResponse.json({ token, path: `/invito/${token}` }, { status: 201 });
}

/** DELETE /api/invites?token=... revokes a link that has not been used yet. */
export async function DELETE(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  revokeInvite(token);
  return NextResponse.json({ ok: true });
}
