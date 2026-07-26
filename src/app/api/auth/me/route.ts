import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me: the current user, or { user: null }. */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
