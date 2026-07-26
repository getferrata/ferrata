/**
 * Post-generation scrub for template artifacts. Small local models sometimes
 * echo pieces of the writing instructions into the module body: skeleton slots
 * like `<the learner, their system and deadline by name>`, instruction section
 * headings, or the whole briefing bullet block. The writing prompt forbids all
 * of this, but the scrub is the guarantee: anything that slips through is
 * removed here before eval and storage.
 *
 * Conservative by design: fenced code blocks are never touched, and the inline
 * slot pattern only matches phrase-like bracketed spans (starts with a lowercase
 * function word, contains at least one space) so real markup such as generics
 * (`Vec<String>`) or autolinks (`<https://...>`) survives.
 */

// Instruction section headings that must never appear as generated headings.
const INSTRUCTION_HEADINGS = [
  "the learner and the course",
  "this module",
  "required anatomy",
  "shape to follow",
  "hard rules",
  "source material (ground on this)",
  "how many, and at what bloom level",
];

// Briefing bullets from the prompt: a leaked block is these bullets verbatim.
const BRIEFING_BULLET_RE =
  /^-\s+\*{0,2}(real goal|domain|the learner starts at|their actual situation, in their words|the concreteness compact this course holds to|depth to reach|profondità|prerequisites already covered)/i;

// Phrase-like template slot: `<the ...>`, `<one ...>`, `<a ...>`, `<what ...>`,
// `<how ...>`, with at least one space inside. Never matches code generics.
const SLOT_RE = /<(?:the|one|a|an|what|how|their|your)\s[^<>\n]{2,90}>/gi;

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line.trim());
}

function headingText(line: string): string | null {
  const m = /^#{1,6}\s+(.*)$/.exec(line.trim());
  return m?.[1] != null ? m[1].trim().toLowerCase() : null;
}

/** Remove template artifacts from a generated module body. */
export function scrubTemplateArtifacts(bodyMd: string): string {
  const out: string[] = [];
  let inFence = false;
  let skippingBriefing = false;

  for (const line of bodyMd.split("\n")) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      skippingBriefing = false;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const heading = headingText(line);

    if (heading !== null) {
      // A leaked instruction heading starts (or continues) a briefing block:
      // drop the heading and swallow its bullet lines until real content.
      if (INSTRUCTION_HEADINGS.includes(heading.replace(/[:.]$/, ""))) {
        skippingBriefing = true;
        continue;
      }
      skippingBriefing = false;
    } else if (skippingBriefing) {
      if (line.trim() === "" || BRIEFING_BULLET_RE.test(line.trim())) continue;
      skippingBriefing = false;
    }

    if (BRIEFING_BULLET_RE.test(line.trim())) continue;

    let cleaned = line.replace(SLOT_RE, "").replace(/[ \t]{2,}/g, " ");
    // A heading or line reduced to scaffolding after slot removal is dropped.
    const residue = cleaned.trim();
    if (
      residue !== line.trim() &&
      (/^#{1,6}\s*(in the real world[,.]?\s*(for)?\s*)?$/i.test(residue) ||
        /^#{1,6}\s*$/.test(residue) ||
        residue === "" ||
        residue === ">")
    ) {
      continue;
    }
    // Tidy punctuation orphaned by a removed slot ("for , the" -> "for the").
    cleaned = cleaned.replace(/\s+([,.;:])/g, "$1");
    out.push(cleaned);
  }

  // Collapse runs of blank lines the removals may have left behind.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
