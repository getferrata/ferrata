/**
 * Mechanical quality rubrics. Pure and testable. These are a
 * guardrail, not the whole judgement. The nuanced call is the LLM judge. The
 * most important check here is specificity: a paragraph that would read
 * identically in a course on another subject is filler.
 */

export interface ModuleContext {
  /** Specific entities from the learner's situation: names, ids, places. */
  anchorTerms: string[];
  domain: string;
}

export interface Check {
  name: string;
  pass: boolean;
  weight: number;
  detail: string;
}

export interface RubricReport {
  checks: Check[];
  score: number; // 0..1 weighted
  pass: boolean;
}

const ANALOGY_CUES =
  /\b(come|è come|come se|immagina|pensa a|analog\w*|l'equivalente|equivalente|funziona come|è l['a]|alla stregua|proprio come|like|imagine|think of|analog\w*)\b/i;

/** Strip fenced code blocks so diagrams/config don't skew prose checks. */
function stripCode(md: string): string {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

function paragraphs(md: string): string[] {
  return stripCode(md)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0 && !/^[#>|\-*]/.test(p));
}

/** Does a paragraph carry any anchor: a number, a proper noun, an anchor term? */
function isAnchored(paragraph: string, anchors: string[]): boolean {
  if (/\d/.test(paragraph)) return true;
  for (const a of anchors) {
    if (a.length >= 2 && paragraph.toLowerCase().includes(a.toLowerCase()))
      return true;
  }
  // A capitalized word not at the start of a sentence → likely a proper noun.
  if (/[.!?]\s+[A-Z][a-z]+|[a-z]\s+[A-Z][A-Za-z]{2,}/.test(paragraph)) {
    // crude, but combined with the others it catches domain nouns
    return /[a-z]\s+[A-Z][A-Za-z]{2,}/.test(paragraph);
  }
  return false;
}

export function runRubrics(
  bodyMd: string,
  ctx: ModuleContext,
): RubricReport {
  const body = bodyMd;
  const stripped = stripCode(body);
  const paras = paragraphs(body);

  const anchorHits = ctx.anchorTerms.reduce(
    (n, t) =>
      n +
      (t.length >= 2
        ? (body.toLowerCase().match(new RegExp(escape(t.toLowerCase()), "g"))
            ?.length ?? 0)
        : 0),
    0,
  );

  const anchoredParas = paras.filter((p) => isAnchored(p, ctx.anchorTerms));
  const specificity = paras.length ? anchoredParas.length / paras.length : 0;

  const numericTokens = (stripped.match(/\b\d[\d.,:/]*\b/g) ?? []).length;

  const checks: Check[] = [
    {
      name: "analogy_present",
      pass: ANALOGY_CUES.test(stripped),
      weight: 1,
      detail: "at least one everyday-domain analogy",
    },
    {
      name: "context_anchored",
      pass: anchorHits >= 2,
      weight: 1.5,
      detail: `references the learner's specific entities (${anchorHits} hits)`,
    },
    {
      name: "specificity",
      pass: specificity >= 0.6,
      weight: 3,
      detail: `${anchoredParas.length}/${paras.length} paragraphs anchored (${specificity.toFixed(2)})`,
    },
    {
      name: "concrete_density",
      pass: numericTokens >= 3,
      weight: 1,
      detail: `${numericTokens} numeric/quantitative tokens`,
    },
    {
      name: "length_ok",
      pass: body.length >= 500 && body.length <= 12000,
      weight: 0.5,
      detail: `${body.length} chars`,
    },
  ];

  const totalW = checks.reduce((s, c) => s + c.weight, 0);
  const score = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0) / totalW;

  // Specificity is a gate: fail it and the module fails regardless of score.
  const specificityCheck = checks.find((c) => c.name === "specificity")!;
  const pass = specificityCheck.pass && score >= 0.7;

  return { checks, score, pass };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
