import { questionSchema } from "./schema";

/**
 * Making a nearly-right batch of questions usable, without guessing.
 *
 * A local model does not get the content wrong so much as the shape, and always
 * in the same few ways. Every miss costs a whole repair call, which on a 7B is
 * two and a half minutes, and a batch is all-or-nothing: one malformed question
 * out of eight throws the other seven away. On the benchmark runs that was most
 * of the wall clock and it still ended with modules shipping untested.
 *
 * The rule this file is written to: rewrite only what is already determined by
 * what the model sent, and never decide anything the student is graded on. The
 * shapes below all keep the correct answer in `expectedAnswer`, in full, which
 * is what makes them recoverable at all. Where the right answer cannot be
 * located in the options the model gave, the question is dropped, because the
 * alternative is inventing which choice is correct, and an mcq that grades the
 * wrong option right is worse than a module with one question fewer.
 */

export interface RepairOutcome {
  value: unknown;
  /** What was changed, deduped. Empty when the output was already valid. */
  notes: string[];
}

const BLOOM = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Bloom's levels are canonically numbered from one, and the models that send a
 * number mean that numbering: 7B output in the capture gives 2 for "what
 * happens during a failover" (understand) and 1 for a recognition question
 * (remember). Read as zero-based those come out as apply and understand, which
 * do not describe the questions. Anything outside 1..6 is not translated.
 */
function bloomFromNumber(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= 6 ? BLOOM[n - 1]! : null;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Where the correct answer sits in a list of choices, or -1 when it is absent. */
function indexOfAnswer(texts: string[], expected: unknown): number {
  if (typeof expected !== "string") return -1;
  const want = norm(expected);
  return texts.findIndex((t) => norm(t) === want);
}

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (isRecord(v) && typeof v.text === "string") return v.text;
  return null;
}

interface Choices {
  options: string[];
  correctIndex: number;
}

/**
 * Rebuild the choices, or null when they cannot be rebuilt honestly.
 *
 * The four shapes seen from local models, all with the answer in
 * `expectedAnswer`:
 *
 *   { correctIndex, incorrectOptions: [...] }   only the wrong ones listed
 *   { A: {text}, B: {text}, ... }               keyed by letter
 *   [ {text, points}, ... ]                     a bare array of objects
 *   [ "a", "b", ... ]                           a bare array of strings
 */
function repairChoices(options: unknown, expected: unknown): Choices | null {
  // The first shape is the only one that says where the answer goes rather than
  // which one it is: the correct text is missing from the list entirely and has
  // to be put back at the index the model reserved for it. Position is
  // presentation; which option is correct is preserved exactly.
  if (isRecord(options) && Array.isArray(options.incorrectOptions)) {
    if (typeof expected !== "string") return null;
    const wrong = options.incorrectOptions.filter(
      (o): o is string => typeof o === "string" && o.trim().length > 0,
    );
    if (wrong.length === 0) return null;
    const raw = options.correctIndex;
    const at =
      typeof raw === "number" && Number.isInteger(raw) && raw >= 0
        ? Math.min(raw, wrong.length)
        : 0;
    const list = [...wrong];
    list.splice(at, 0, expected);
    return { options: list, correctIndex: at };
  }

  // The rest list every choice including the right one, so the answer is found
  // by matching the text. No match means the model never said which one is
  // correct, and nothing here is willing to pick.
  let texts: (string | null)[] | null = null;
  if (Array.isArray(options)) {
    texts = options.map(textOf);
  } else if (isRecord(options) && !("options" in options)) {
    // Keyed by letter. Key order is the order the model wrote them in, which is
    // the order the letters were meant to be read in.
    texts = Object.values(options).map(textOf);
  }
  if (!texts || texts.some((t) => t === null || t.trim().length === 0)) {
    return null;
  }
  const list = texts as string[];
  if (list.length < 2) return null;
  const at = indexOfAnswer(list, expected);
  return at < 0 ? null : { options: list, correctIndex: at };
}

function repairQuestion(q: unknown, notes: Set<string>): unknown {
  if (!isRecord(q)) return q;
  const out: Record<string, unknown> = { ...q };

  const bloom = out.bloomLevel;
  if (typeof bloom === "number" || (typeof bloom === "string" && /^\d+$/.test(bloom))) {
    const mapped = bloomFromNumber(Number(bloom));
    if (mapped) {
      out.bloomLevel = mapped;
      notes.add("bloomLevel arrived as a number and was read as Bloom's own numbering");
    }
  }

  // A list where a sentence was asked for. Joining keeps every wording the
  // model offered; picking one of them would be discarding an answer the
  // student may well give.
  if (
    Array.isArray(out.expectedAnswer) &&
    out.expectedAnswer.every((x) => typeof x === "string")
  ) {
    out.expectedAnswer = (out.expectedAnswer).join("\n");
    notes.add("expectedAnswer arrived as a list and was joined");
  }

  if (out.options !== undefined && out.options !== null) {
    const already =
      isRecord(out.options) &&
      Array.isArray(out.options.options) &&
      typeof out.options.correctIndex === "number";
    if (!already) {
      const fixed = repairChoices(out.options, out.expectedAnswer);
      if (fixed) {
        out.options = fixed;
        notes.add("multiple-choice options were rebuilt around the stated answer");
      }
      // Left as it arrived when it cannot be rebuilt, so the question fails
      // validation below and is dropped rather than quietly becoming an mcq
      // with no choices, which the reader would meet as a broken question.
    }
  }

  return out;
}

/**
 * Repair a write_questions payload in place of failing the whole call.
 *
 * Questions that survive are kept even when their neighbours do not: a batch is
 * one billed call, and throwing away seven good questions because the eighth
 * was malformed is what made a local course take an hour and ship untested. The
 * count that was lost is reported, never swallowed, since a model quietly
 * getting worse would otherwise look like a model that is fine.
 */
export function repairQuestions(value: unknown): RepairOutcome {
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return { value, notes: [] };
  }
  const notes = new Set<string>();
  const kept: unknown[] = [];
  let dropped = 0;
  for (const raw of value.questions) {
    const fixed = repairQuestion(raw, notes);
    if (questionSchema.safeParse(fixed).success) kept.push(fixed);
    else dropped++;
  }
  if (kept.length === 0) {
    // Nothing survived: hand back what arrived so the caller reports the
    // model's real error rather than "questions: array must contain at least 1".
    return { value, notes: [] };
  }
  if (dropped > 0) {
    notes.add(
      `${dropped} question(s) could not be made valid without guessing the answer and were dropped`,
    );
  }
  return { value: { ...value, questions: kept }, notes: [...notes] };
}
