import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { llmSetupStatus } from "@/lib/llm/setup";

export const runtime = "nodejs";

/**
 * GET /api/setup: is generation ready to work, what would it use, and what a
 * course roughly costs. Drives the first-run callout and the pre-build cost
 * line. Examiners only (students never generate).
 */
export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  return NextResponse.json(await llmSetupStatus());
}
