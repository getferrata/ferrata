import type { RetrievedChunk } from "@/lib/sources/retrieve";

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

  // 3. The house anatomy is a set of sections. A body with no subheadings is a
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

  return { hard, soft };
}
