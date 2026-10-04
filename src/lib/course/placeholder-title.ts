const MAX = 80;

/**
 * A title to show until the real one is derived, made from what the author wrote.
 *
 * It used to be the first 80 characters, which is how a page ended up headed
 * "Onboard a new backend engineer joining the checkout team at Acme Payments.
 * They": the review step shows it for as long as the author takes to read the
 * plan. The first sentence is nearly always a fine title; failing that, the cut
 * falls between words, and never inside a protection placeholder (⟨cxt:…⟩),
 * where half of one reads as noise.
 */
export function placeholderTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]!.trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  if (sentence.length <= MAX) return sentence;

  let cut = sentence.slice(0, MAX + 1);
  const lastSpace = cut.lastIndexOf(" ");
  cut = lastSpace > MAX / 2 ? cut.slice(0, lastSpace) : cut.slice(0, MAX);
  // Not inside an unclosed placeholder.
  const open = cut.lastIndexOf("⟨");
  if (open !== -1 && cut.indexOf("⟩", open) === -1) cut = cut.slice(0, open);
  return cut.replace(/[\s,;:–-]+$/, "") + "…";
}
