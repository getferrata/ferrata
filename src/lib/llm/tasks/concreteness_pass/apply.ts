import type { ConcretenessEdits, ConcretenessResult } from "./schema";

/**
 * The placeholders a body carries that stand for something stored elsewhere: a
 * value Contextia is holding back, and a picture pulled out of a source
 * document. Both are filled in for the reader afterwards.
 */
const TOKENS = /⟨(?:cxt|fig):[0-9a-f]{8,32}⟩/g;

/**
 * Whether an edit would quietly take a placeholder out of the module.
 *
 * These are not words, they are references, and losing one is not a wording
 * change: a dropped `cxt` leaves a sentence about a value that is no longer
 * named, and a dropped `fig` deletes a diagram from the course while the prose
 * around it goes on describing the picture. Neither shows up as an error, and
 * an editing stage has every incentive to remove something that reads as noise.
 *
 * So it is refused here rather than discouraged in the prompt. An edit that
 * genuinely needs to rewrite the sentence around a token can still do so by
 * carrying the token through into its replacement, which is the thing that was
 * wanted anyway.
 */
function dropsToken(find: string, replace: string): boolean {
  const before = find.match(TOKENS);
  if (!before) return false;
  const after = new Set(replace.match(TOKENS) ?? []);
  return before.some((t) => !after.has(t));
}

/**
 * Apply the concreteness pass's edits to a module body.
 *
 * The rules are deliberately strict, because the failure this replaces was a
 * silent one. An edit whose `find` is absent from the body is the model quoting
 * text that is not there; an edit whose `find` appears twice does not say which
 * one it means. Both are refused and reported rather than guessed at, since a
 * replacement made in the wrong place is worse than one not made at all, and
 * the caller can then decide whether the result is still worth keeping.
 *
 * Edits are applied in order, each to the result of the last, which is how a
 * person would make them and is what lets a later edit refer to text an earlier
 * one produced. The cost is that an edit can be invalidated by an earlier one;
 * that shows up as "not found" and is reported like any other miss.
 */
export function applyConcretenessEdits(
  bodyMd: string,
  out: ConcretenessEdits,
): ConcretenessResult {
  let text = bodyMd;
  let applied = 0;
  const rejected: ConcretenessResult["rejected"] = [];

  for (const edit of out.edits) {
    const first = text.indexOf(edit.find);
    if (first === -1) {
      rejected.push({ find: edit.find, reason: "not found" });
      continue;
    }
    if (text.indexOf(edit.find, first + edit.find.length) !== -1) {
      rejected.push({ find: edit.find, reason: "ambiguous" });
      continue;
    }
    if (dropsToken(edit.find, edit.replace)) {
      rejected.push({ find: edit.find, reason: "drops a placeholder" });
      continue;
    }
    text = text.slice(0, first) + edit.replace + text.slice(first + edit.find.length);
    applied++;
  }

  // The why of each applied edit is the note. Kept separate from the model's
  // own notes so the two cannot drift: a note about a change that was refused
  // would describe a module that does not exist.
  const notes = [
    ...out.edits
      .filter((e) => e.why && !rejected.some((r) => r.find === e.find))
      .map((e) => e.why),
    ...out.notes,
  ].slice(0, 40);

  return { bodyMd: text, notes, applied, rejected };
}

/**
 * Whether a result is worth keeping over the draft it was made from.
 *
 * A pass where most edits missed is not a lightly-imperfect edit, it is a model
 * that was working from a text it could not see properly, and the parts that
 * did land are as likely to be wrong as the parts that did not. Below this the
 * caller keeps the draft, which is the same thing that happens when the stage
 * fails outright.
 */
export function editsAreTrustworthy(result: ConcretenessResult): boolean {
  const total = result.applied + result.rejected.length;
  if (total === 0) return true; // nothing proposed: the draft was already fine
  return result.applied / total >= 0.5;
}
