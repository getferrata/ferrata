/**
 * Parse a course glossary (markdown) into term→definition pairs, so module
 * bodies can surface a definition inline the first time a term appears. The
 * learner's stated pain is unexplained jargon; this closes that loop without
 * making them leave the page for the glossary.
 *
 * Expected glossary line shape: `**Term**: definition.`
 * (em dash, en dash, hyphen or colon all accepted).
 */
export interface GlossaryTerm {
  term: string;
  def: string;
}

function clean(s: string): string {
  return s
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .trim();
}

export function parseGlossaryTerms(
  md: string | null | undefined,
): GlossaryTerm[] {
  if (!md) return [];
  const out: GlossaryTerm[] = [];
  const seen = new Set<string>();
  const add = (term: string, def: string): void => {
    const t = term.trim();
    const key = t.toLowerCase();
    if (t.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push({ term: t, def });
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^\*\*(.+?)\*\*\s*[—–:-]\s*(.+)$/);
    if (!m || !m[1] || !m[2]) continue;
    const term = clean(m[1]);
    const def = clean(m[2]);
    if (!def) continue;
    add(term, def);
    // "Riconciliazione (recon)" → also register the bare head "Riconciliazione".
    const head = term.replace(/\s*\(.*\)\s*$/, "").trim();
    if (head && head !== term) add(head, def);
    // "…(recon)" → also register the parenthetical token itself.
    const paren = term.match(/\(([\p{L}\p{N}_-]{2,})\)/u);
    if (paren?.[1]) add(paren[1], def);
  }
  return out;
}
