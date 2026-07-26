import { NextResponse } from "next/server";
import { parsePackage, previewPackage } from "@/lib/package/import";

import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/** POST /api/import/preview: validate an untrusted package, return metadata. */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const raw = (await req.json().catch(() => null)) as unknown;
  try {
    const pkg = parsePackage(raw);
    return NextResponse.json({ preview: previewPackage(pkg) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid package" },
      { status: 400 },
    );
  }
}
