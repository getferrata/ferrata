import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, explanations, modules } from "@/db/schema";
import { runFeynman } from "@/lib/llm/tasks/feynman";
import { getCurrentUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { withActor } from "@/lib/llm/actor";
import { newId, now } from "@/lib/util/id";

export const runtime = "nodejs";

interface Body {
  conceptId?: unknown;
  explanation?: unknown;
}

/** POST /api/feynman: return where the learner's explanation has a gap. */
export async function POST(req: Request): Promise<NextResponse> {
  // Grading an explanation is an LLM call, so establish who is asking before
  // spending anything, not afterwards when it is only useful for the record.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const conceptId = typeof body.conceptId === "string" ? body.conceptId : "";
  const explanation =
    typeof body.explanation === "string" ? body.explanation.trim() : "";
  if (!conceptId || explanation.length < 15) {
    return NextResponse.json(
      { error: "conceptId and a real explanation are required" },
      { status: 400 },
    );
  }

  const concept = db
    .select()
    .from(concepts)
    .where(eq(concepts.id, conceptId))
    .get();
  if (!concept) {
    return NextResponse.json({ error: "concept not found" }, { status: 404 });
  }
  // A concept id is guessable, so being signed in is not enough: it has to be
  // a course this person was actually given.
  if (!canSeeCourse(concept.courseId, { userId: user.id, role: user.role })) {
    return NextResponse.json({ error: "concept not found" }, { status: 404 });
  }
  const mod = db
    .select()
    .from(modules)
    .where(eq(modules.conceptId, conceptId))
    .get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, concept.courseId))
    .get();

  try {
    const result = await withActor({ userId: user.id }, () =>
      runFeynman(
        {
          lang: course?.lang ?? "it",
          conceptTitle: concept.title,
          bodyMd: mod?.bodyMd ?? concept.summary,
          explanation,
        },
        concept.courseId,
      ),
    );
    // The verdict is readiness evidence, not just feedback: record it so the
    // dashboard can show which concepts were explained in the learner's own
    // words and which explanations still had a gap.
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: concept.id,
        userId: user.id,
        complete: result.complete,
        gap: result.gap,
        createdAt: now(),
      })
      .run();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "The Feynman coach is unavailable: it needs a configured LLM (local Ollama or an API key).",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
