import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, questions, reviews } from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { review, type Confidence, type StoredCard } from "@/lib/fsrs";
import { getCurrentUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { gradeAnswer, parseOptions, type SubmittedAnswer } from "@/lib/review/grade";

export const runtime = "nodejs";

interface Body {
  questionId?: unknown;
  correct?: unknown;
  confidence?: unknown;
  /** Multiple choice: which option, by its stored index. */
  choiceIndex?: unknown;
  /** Cloze: one string per blank, in order. */
  blanks?: unknown;
}

const CONF = new Set(["low", "medium", "high"]);

/** What the client claims it did, before the stored question has its say. */
function readAnswer(body: Body): SubmittedAnswer {
  if (typeof body.choiceIndex === "number") {
    return { kind: "choice", index: body.choiceIndex };
  }
  if (Array.isArray(body.blanks)) {
    return {
      kind: "blanks",
      values: body.blanks.map((b) => (typeof b === "string" ? b : "")),
    };
  }
  return { kind: "self", correct: body.correct === true };
}

/**
 * POST /api/reviews: record one answered review and advance its FSRS card.
 *
 * The submitted verdict is believed only for the formats nothing else can
 * judge. A multiple choice is settled against the stored answer, so a client
 * claiming it was right about one it got wrong changes nothing, and the record
 * says which of the two decided.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const confidence =
    typeof body.confidence === "string" && CONF.has(body.confidence)
      ? (body.confidence as Confidence)
      : "medium";

  if (!questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }

  // Reviews are the record a course's readiness is built from. This endpoint
  // took anonymous writes for any question id, so anyone who could reach the
  // server could fill somebody else's course with answers.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const q = db
    .select({
      id: questions.id,
      format: questions.format,
      optionsJson: questions.optionsJson,
      blanksJson: questions.blanksJson,
      expectedAnswer: questions.expectedAnswer,
      prompt: questions.prompt,
      retiredAt: questions.retiredAt,
      courseId: concepts.courseId,
    })
    .from(questions)
    .innerJoin(concepts, eq(questions.conceptId, concepts.id))
    .where(eq(questions.id, questionId))
    .get();
  if (!q) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // The module was rewritten while this page was open: the question still
  // exists so its history stays readable, but it is no longer part of the
  // course and answering it now would file evidence against a retired test.
  if (q.retiredAt !== null) {
    return NextResponse.json(
      { error: "This question was replaced when the module was rewritten." },
      { status: 409 },
    );
  }
  if (!canSeeCourse(q.courseId, { userId: user.id, role: user.role })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { correct, gradedBy } = gradeAnswer(q, readAnswer(body));
  const userId = user.id;

  // An assessed course is a measurement, and a measurement you can retake after
  // being shown the answer measures nothing. One machine-settled answer per
  // question per student is the whole guarantee; practice mode keeps the
  // spaced-repetition loop, which is where repeating is the point.
  const assessed =
    db
      .select({ mode: courses.assessmentMode })
      .from(courses)
      .where(eq(courses.id, q.courseId))
      .get()?.mode === "assessed";
  if (assessed && gradedBy === "system") {
    const prior = db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.questionId, questionId),
          eq(reviews.userId, userId),
          ne(reviews.gradedBy, "self"),
        ),
      )
      .get();
    if (prior) {
      return NextResponse.json(
        {
          error:
            "You have already answered this question. In an assessed course it counts once.",
        },
        { status: 409 },
      );
    }
  }

  // Load THIS student's most recent FSRS state for this question, so each
  // learner's schedule is independent.
  const last = db
    .select()
    .from(reviews)
    .where(and(eq(reviews.questionId, questionId), eq(reviews.userId, userId)))
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
      gradedBy,
      fsrsStateJson: JSON.stringify(next),
      // What was actually asked, as it read at this moment. The module can be
      // rewritten later; the record of what this person answered should not
      // start pointing at wording they never saw.
      questionPrompt: q.prompt,
    })
    .run();

  // The verdict AND the answer go back, because for a graded format the client
  // holds neither: the correct option and the model answer are deliberately
  // kept off the page until the student has answered, so the after-answer
  // reveal is driven from here, not from a shipped key.
  //
  // Except on a wrong answer in an assessed course. Revealing there hands over
  // the key to a question that still counts, and the retake guard above is only
  // half the fix: the other half is not showing what to retake with.
  const reveal =
    assessed && !correct
      ? null
      : {
          correctIndex: parseOptions(q.optionsJson)?.correctIndex ?? null,
          expectedAnswer: q.expectedAnswer,
        };
  return NextResponse.json(
    { ok: true, due: next.due, correct, gradedBy, reveal },
    { status: 201 },
  );
}
