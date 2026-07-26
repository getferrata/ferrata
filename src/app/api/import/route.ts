import { NextResponse } from "next/server";
import { importPackage, parsePackage } from "@/lib/package/import";

import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/** POST /api/import: import a validated package as a new (untrusted) course. */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const raw = (await req.json().catch(() => null)) as unknown;
  try {
    const pkg = parsePackage(raw);
    const courseId = importPackage(pkg);
    return NextResponse.json({ courseId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 400 },
    );
  }
}
