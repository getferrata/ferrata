import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { getCurrentUser } from "@/lib/auth/session";
import type { InterviewState } from "@/lib/llm/tasks/interview_questions";

export const runtime = "nodejs";

interface Body {
  answers?: unknown;
}

/**
 * POST /api/courses/:id/interview: record the author's interview answers (or a
 * skip), fold them into author_context_md, and kick off generation.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // This endpoint starts generation, which spends. It was reachable by anyone.
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const answers: Record<string, string> =
    body.answers && typeof body.answers === "object"
      ? Object.fromEntries(
          Object.entries(body.answers as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
            .map(([k, v]) => [k, String(v).trim()]),
        )
      : {};

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  const state: InterviewState = course.interviewJson
    ? (JSON.parse(course.interviewJson) as InterviewState)
    : { questions: [], answers: {} };
  state.answers = answers;

  // Compose the author context: each answered question as Q/A, in the material's
  // language-neutral markdown. This is what the intake reads.
  const contextMd = state.questions
    .map((q) => {
      const a = answers[q.key];
      return a ? `**${q.question}**\n${a}` : null;
    })
    .filter((s): s is string => Boolean(s))
    .join("\n\n");

  db.update(courses)
    .set({
      interviewJson: JSON.stringify(state),
      authorContextMd: contextMd || null,
      status: "intake",
    })
    .where(eq(courses.id, id))
    .run();

  enqueue("intake", { courseId: id, actorUserId: me.id });

  return NextResponse.json({ ok: true, answered: Object.keys(answers).length });
}
