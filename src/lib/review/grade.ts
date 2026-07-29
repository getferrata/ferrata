import type { QuestionFormat } from "@/db/schema";

/**
 * Who decided whether an answer was right.
 *
 * The distinction is the whole point. Until this existed, every answer was
 * graded by the student pressing "I had it", and the readiness an examiner sees
 * was only as honest as the person being measured. A number built from
 * self-grading is fine for learning and worthless for assessment, and nothing
 * in the data said which one you were looking at.
 */
export type GradedBy = "self" | "system" | "model";

/** A multiple-choice question's stored shape. */
export interface StoredOptions {
  options: string[];
  correctIndex: number;
}

/** One blank in a cloze, with every wording that counts as right. */
export interface StoredBlank {
  accept: string[];
}

export interface GradableQuestion {
  format: QuestionFormat;
  optionsJson: string | null;
  blanksJson: string | null;
}

/** What the student sent back, by format. */
export type SubmittedAnswer =
  | { kind: "choice"; index: number }
  | { kind: "blanks"; values: string[] }
  | { kind: "self"; correct: boolean };

export function parseOptions(json: string | null): StoredOptions | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<StoredOptions>;
    if (!Array.isArray(v.options) || v.options.length < 2) return null;
    if (typeof v.correctIndex !== "number") return null;
    if (v.correctIndex < 0 || v.correctIndex >= v.options.length) return null;
    if (!v.options.every((o) => typeof o === "string" && o.length > 0)) return null;
    return { options: v.options, correctIndex: v.correctIndex };
  } catch {
    return null;
  }
}

export function parseBlanks(json: string | null): StoredBlank[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: StoredBlank[] = [];
    for (const b of v) {
      const accept = (b as Partial<StoredBlank>)?.accept;
      if (!Array.isArray(accept) || accept.length === 0) return null;
      if (!accept.every((a) => typeof a === "string" && a.trim())) return null;
      out.push({ accept });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Whether the system can settle this question without taking the student's
 * word for it. A multiple choice always can. A cloze only when the generator
 * gave the accepted wordings: courses built before that field existed have a
 * prose explanation where the answer should be, and guessing at it would grade
 * people wrongly, which is worse than not grading them at all.
 */
export function autoGradable(q: GradableQuestion): boolean {
  if (q.format === "mcq") return parseOptions(q.optionsJson) !== null;
  if (q.format === "cloze") return parseBlanks(q.blanksJson) !== null;
  return false;
}

/**
 * Compare loosely enough to accept a human typing, strictly enough to stay a
 * test: case, accents, surrounding punctuation and repeated spaces do not
 * decide whether somebody knows the answer.
 */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Grade {
  correct: boolean;
  gradedBy: GradedBy;
}

/**
 * Settle one answer.
 *
 * A submitted grade is only believed for the formats nothing else can judge.
 * For the rest the stored question decides, so a client that claims it was
 * right about a multiple choice it got wrong changes nothing.
 */
export function gradeAnswer(
  q: GradableQuestion,
  answer: SubmittedAnswer,
): Grade {
  if (q.format === "mcq") {
    const opts = parseOptions(q.optionsJson);
    if (opts) {
      const chosen = answer.kind === "choice" ? answer.index : -1;
      return { correct: chosen === opts.correctIndex, gradedBy: "system" };
    }
  }
  if (q.format === "cloze") {
    const blanks = parseBlanks(q.blanksJson);
    if (blanks) {
      const given = answer.kind === "blanks" ? answer.values : [];
      const correct =
        given.length === blanks.length &&
        blanks.every((b, i) =>
          b.accept.some((a) => normalise(a) === normalise(given[i] ?? "")),
        );
      return { correct, gradedBy: "system" };
    }
  }
  // Open and explain-back: only the reader can say, so the honest record is
  // that they said it.
  return { correct: answer.kind === "self" ? answer.correct : false, gradedBy: "self" };
}

/**
 * The client-safe view of a question.
 *
 * In assessed mode a question that counts toward the readiness figure must not
 * carry its answer to the browser before the student answers, or the
 * measurement is self-reported through the page source. The option texts still
 * ship (the student has to see the choices) and the prompt still carries its
 * blanks; only the key is withheld, and the reviews response returns it once
 * the answer is in.
 */
export interface ClientQuestion {
  id: string;
  prompt: string;
  bloomLevel: string;
  format: QuestionFormat;
  /** The system can settle this one, so the client renders answer inputs. */
  autoGraded: boolean;
  /** mcq option texts, without the correct index; null for other formats. */
  options: string[] | null;
  /** Correct option index for the after-answer highlight; null when withheld. */
  correctIndex: number | null;
  /** Model answer shown on reveal; null when withheld until graded. */
  expectedAnswer: string | null;
}

interface RawQuestion {
  id: string;
  prompt: string;
  bloomLevel: string;
  format: QuestionFormat;
  expectedAnswer: string;
  optionsJson: string | null;
  blanksJson: string | null;
}

export function toClientQuestion(
  q: RawQuestion,
  assessed: boolean,
): ClientQuestion {
  const auto = autoGradable(q);
  const opts = parseOptions(q.optionsJson);
  const withhold = assessed && auto;
  return {
    id: q.id,
    prompt: q.prompt,
    bloomLevel: q.bloomLevel,
    format: q.format,
    autoGraded: auto,
    options: opts ? opts.options : null,
    correctIndex: opts && !withhold ? opts.correctIndex : null,
    expectedAnswer: withhold ? null : q.expectedAnswer,
  };
}

/**
 * Display order for a multiple choice, stable per question and per student.
 *
 * The generator tends to put the right answer in the same neighbourhood, and a
 * fixed order lets somebody learn the position instead of the material. Seeded
 * so a reload does not reshuffle under the reader's hands, and the returned
 * items carry their original index so grading is unaffected. Takes only the
 * option texts, never the correct index, so shuffling on the client leaks
 * nothing.
 */
export function shuffledOptions(
  options: string[],
  seed: string,
): { text: string; index: number }[] {
  const items = options.map((text, index) => ({ text, index }));
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = items.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = Math.abs(h >>> 0) % (i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** How many blanks a cloze prompt shows, so the form can offer that many boxes. */
export function countBlanks(prompt: string): number {
  return (prompt.match(/_{2,}/g) ?? []).length;
}
