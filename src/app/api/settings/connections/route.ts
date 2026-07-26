import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import {
  addCredential,
  deleteCredential,
  listCredentials,
  normalizeHost,
} from "@/lib/sources/credentials";
import { maskSecret } from "@/lib/settings";

export const runtime = "nodejs";

/** GET /api/settings/connections: stored site credentials, secrets masked. */
export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  return NextResponse.json({
    connections: listCredentials().map((c) => ({
      id: c.id,
      host: c.host,
      kind: c.kind,
      username: c.username,
      secret: maskSecret(c.secret),
    })),
  });
}

const postSchema = z.object({
  host: z.string().min(1),
  kind: z.enum(["basic", "bearer"]),
  username: z.string().optional(),
  secret: z.string().min(1),
});

/** POST /api/settings/connections: add or replace the credential for a host. */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const host = normalizeHost(parsed.data.host);
  if (!host) {
    return NextResponse.json({ error: "invalid host" }, { status: 400 });
  }
  const row = addCredential({ ...parsed.data, host });
  return NextResponse.json(
    { ok: true, id: row.id, host: row.host },
    { status: 201 },
  );
}

/** DELETE /api/settings/connections?id=: remove a stored credential. */
export async function DELETE(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  deleteCredential(id);
  return NextResponse.json({ ok: true });
}
