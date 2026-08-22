import type { RetrievedChunk } from "@/lib/sources/retrieve";
import { BODY_DELIMITER } from "@/lib/llm/tasks/body_delimiter";

/**
 * Deterministic checks on a generated module body. These exist because a model
 * asked to grade or fix its own output does not reliably catch its own
 * inventions (intrinsic self-correction is weak), and an LLM judge has an
 * authority bias that rewards a confident fabrication. String-exact facts, on
 * the other hand, are precisely what code checks well: a citation either names a
 * real source or it does not. `hard` violations block acceptance and drive a
 * targeted repair; `soft` ones only enrich the repair feedback when a repair is
 * already happening. Every check is high-precision, so the mock and real, valid
 * modules pass without spurious repairs.
 */
export interface VerifyResult {
  hard: string[];
  soft: string[];
}

export interface VerifyInput {
  bodyMd: string;
  /** The excerpts the module was grounded on, with their real source names. */
  sources: RetrievedChunk[];
  depthLevel: number;
}

const CITATION = /\[source:\s*([^\]]+)\]/gi;
const CXT_CLOSED = /⟨cxt[^⟩]*⟩/g;
const CXT_WELLFORMED = /^⟨cxt:[0-9a-f]+⟩$/;
const HEADING = /^\s{0,3}#{2,4}\s+\S/gm;
/** The delimiter on a line of its own, matching how the split finds it. */
const BODY_LINE = /^---BODY---[ \t]*$/m;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function verifyModule(input: VerifyInput): VerifyResult {
  const { bodyMd, sources, depthLevel } = input;
  const hard: string[] = [];
  const soft: string[] = [];

  // 1. Every citation must name a source the module was actually given. A name
  //    it was never shown is an invention, and the reader cannot tell an invented
  //    citation from a real one.
  const known = new Set(sources.map((s) => norm(s.sourceName)));
  const cited: string[] = [];
  for (const m of bodyMd.matchAll(CITATION)) {
    const name = m[1]!.trim();
    cited.push(name);
    if (!known.has(norm(name))) {
      hard.push(
        `Citation [source: ${name}] names a document that was not provided. Cite only the exact source names in the material, or drop the claim.`,
      );
    }
  }

  // 2. Protected placeholders must be reproduced verbatim. A mangled one (a space,
  //    a truncated hash, a missing bracket) will not be filled back in and ships
  //    as a leak of the shape of a redacted value.
  const closed = bodyMd.match(CXT_CLOSED) ?? [];
  for (const t of closed) {
    if (!CXT_WELLFORMED.test(t)) {
      hard.push(
        `Malformed protected placeholder "${t}": reproduce it exactly as it appears in the material, unchanged.`,
      );
    }
  }
  const openCount = (bodyMd.match(/⟨cxt/g) ?? []).length;
  if (openCount > closed.length) {
    hard.push(
      "A protected placeholder is missing its closing bracket; reproduce every ⟨cxt:...⟩ token exactly and whole.",
    );
  }

  // 3. The body must not carry another delimiter line. The split takes the
  //    first one, so a model that writes a module, emits the marker again and
  //    writes a second draft ships both: the student reads the module twice,
  //    the second time as raw markdown inside a code fence. Seen once on a 7B,
  //    where the second draft was a different and better module than the first.
  //    Repaired rather than cut: the marker can also arrive from the material
  //    itself, and splitting again would drop the beginning of a real body to
  //    fix a cosmetic problem.
  if (BODY_LINE.test(bodyMd)) {
    hard.push(
      `The body contains another "${BODY_DELIMITER}" line. Send the module once: the header fields, one marker, then one body. Do not restart the answer.`,
    );
  }

  // 4. The house anatomy is a set of sections. A body with no subheadings is a
  //    wall of text that skipped the structure entirely.
  const headings = (bodyMd.match(HEADING) ?? []).length;
  if (headings < 2) {
    hard.push(
      "The module has no section structure: write it with the anatomy subheadings (the idea, what's inside, in the real world, before/next to this).",
    );
  }

  // Soft: material was provided but nothing is cited. Not a hard failure (a
  // module can legitimately lean on general knowledge), but worth nudging.
  if (sources.length > 0 && cited.length === 0) {
    soft.push(
      "Material was attached but nothing is cited; ground the concrete claims with [source: <name>] using the exact source names.",
    );
  }

  // Soft: too thin for the depth asked. A deeper module needs more room; a very
  // short body at depth 2-3 has skipped the operational detail.
  const minChars = 500 + depthLevel * 250;
  if (bodyMd.length < minChars) {
    soft.push(
      `The body is thin for depth ${depthLevel} (${bodyMd.length} chars, target >= ${minChars}); develop the concrete sections further.`,
    );
  }

  const code = verifyCodeFidelity(bodyMd, sources);
  hard.push(...code.hard);
  soft.push(...code.soft);

  return { hard, soft };
}

/**
 * Code shown in a module must be the code that is in the material.
 *
 * A course whose promise is that you will know a codebase as if you had written
 * it fails completely if a snippet is subtly wrong. And subtly wrong is the
 * likely shape: a model reproducing a function it was shown will get it right
 * almost always, and the rare miss is a renamed variable or a flipped
 * comparison, which reads perfectly and teaches the opposite of the truth.
 *
 * Two different findings, because they mean opposite things.
 *
 * A block whose lines are mostly in the material with a few that are not is a
 * quotation with corruptions in it, and that is `hard`: the reader would take
 * it for the real code. A block with nothing in common with the material is an
 * illustration the model wrote itself, which is legitimate often enough to be
 * only `soft`: an example of a wrong config, a minimal sketch, a diagram.
 *
 * Trivial lines are dropped before either judgement. A line that is just a
 * brace matches everywhere and would push any block over any threshold.
 */
const FENCE = /^[ \t]*```([A-Za-z0-9+#-]*)[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

/** Tags whose contents are meant to be real code rather than a drawing. */
const CODE_TAG =
  /^(ts|tsx|typescript|js|jsx|javascript|py|python|go|rs|rust|java|rb|ruby|php|c|cpp|cs|kt|swift|scala|sh|bash|zsh|ps1|sql|json|yaml|yml|toml|hcl|tf|dockerfile)$/i;

function codeLines(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    // Punctuation-only and very short lines match anything, so they decide
    // nothing and are left out of both the numerator and the denominator.
    .filter((l) => l.length >= 8 && /[A-Za-z0-9_]/.test(l));
}

export function verifyCodeFidelity(
  bodyMd: string,
  sources: readonly { text: string }[],
): VerifyResult {
  const hard: string[] = [];
  const soft: string[] = [];
  if (sources.length === 0) return { hard, soft };

  const known = new Set<string>();
  for (const s of sources) for (const l of codeLines(s.text)) known.add(l);
  if (known.size === 0) return { hard, soft };

  for (const m of bodyMd.matchAll(FENCE)) {
    const tag = (m[1] ?? "").trim();
    const lines = codeLines(m[2] ?? "");
    // An untagged fence is as likely to be an ascii diagram or a shell
    // transcript as it is to be code, and guessing wrong here costs a repair.
    if (!CODE_TAG.test(tag) || lines.length < 3) continue;

    const missing = lines.filter((l) => !known.has(l));
    if (missing.length === 0) continue;

    const matched = lines.length - missing.length;
    if (matched / lines.length >= 0.6) {
      hard.push(
        `A \`\`\`${tag} block quotes the material but ${missing.length} of its ${lines.length} lines are not in it as written, starting with "${missing[0]!.slice(0, 80)}". Reproduce the code exactly as the material has it, or drop the lines you cannot ground.`,
      );
    } else {
      soft.push(
        `A \`\`\`${tag} block matches nothing in the material. If it is your own illustration rather than the reader's code, say so in the text beside it.`,
      );
    }
  }
  return { hard, soft };
}
