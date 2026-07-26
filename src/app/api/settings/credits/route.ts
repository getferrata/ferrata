import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { setSetting } from "@/lib/settings";
import {
  CREDIT_LIMIT_KEY,
  CREDIT_WINDOW_KEY,
  creditLimit,
  creditWindowMs,
} from "@/lib/llm/credits";

export const runtime = "nodejs";

const schema = z.object({
  // Empty string clears the ceiling.
  limit: z.string().max(12),
  windowDays: z.string().max(6).optional(),
});

/** GET the current ceiling, for the settings form. */
export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  return NextResponse.json({
    limit: creditLimit(),
    windowDays: Math.round(creditWindowMs() / (24 * 60 * 60 * 1000)),
  });
}

/** POST a per-person credit ceiling. Blank means no ceiling. */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const raw = parsed.data.limit.trim();
  if (raw === "") {
    setSetting(CREDIT_LIMIT_KEY, "");
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "the limit must be a positive number of credits, or blank" },
        { status: 400 },
      );
    }
    setSetting(CREDIT_LIMIT_KEY, String(Math.floor(n)));
  }

  const win = parsed.data.windowDays?.trim();
  if (win !== undefined && win !== "") {
    const d = Number(win);
    if (!Number.isFinite(d) || d < 0) {
      return NextResponse.json(
        { error: "the window must be a number of days, 0 for all time" },
        { status: 400 },
      );
    }
    setSetting(CREDIT_WINDOW_KEY, String(Math.floor(d)));
  }

  return NextResponse.json({ ok: true, limit: creditLimit() });
}
