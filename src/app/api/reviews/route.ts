import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviews } from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { review, type Confidence, type StoredCard } from "@/lib/fsrs";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

interface Body {
  questionId?: unknown;
  correct?: unknown;
  confidence?: unknown;
}

const CONF = new Set(["low", "medium", "high"]);

/** POST /api/reviews: record one answered review and advance its FSRS card. */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const correct = body.correct === true;
  const confidence =
    typeof body.confidence === "string" && CONF.has(body.confidence)
      ? (body.confidence as Confidence)
      : "medium";

  if (!questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const userId = user?.id ?? null;

  // Load THIS student's most recent FSRS state for this question, so each
  // learner's schedule is independent.
  const last = db
    .select()
    .from(reviews)
    .where(
      userId
        ? and(eq(reviews.questionId, questionId), eq(reviews.userId, userId))
        : eq(reviews.questionId, questionId),
    )
    .orderBy(desc(reviews.answeredAt))
    .limit(1)
    .get();

  const prior: StoredCard | null = last?.fsrsStateJson
    ? (JSON.parse(last.fsrsStateJson) as StoredCard)
    : null;

  const { next } = review(prior, correct, confidence);

  db.insert(reviews)
    .values({
      id: newId("review"),
      questionId,
      userId,
      answeredAt: now(),
      correct,
      confidence,
      fsrsStateJson: JSON.stringify(next),
    })
    .run();

  return NextResponse.json({ ok: true, due: next.due }, { status: 201 });
}
