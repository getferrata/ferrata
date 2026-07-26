/**
 * De-mark inline markdown so a title or summary renders cleanly where we show it
 * as PLAIN text: module H1, "La via" list, graph nodes, nav, review, library.
 *
 * Concept titles and summaries come from the LLM (build_graph / write_module) or
 * from imported packages (untrusted), and either may carry `code`,
 * **bold** or *emphasis* markers that read as noise when printed literally. This
 * is cosmetic only. The security boundary for rendered bodies is
 * renderMarkdown + sanitize, not this.
 */
export function plainText(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/__([^_]+)__/g, "$1") // __bold__ → bold
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2") // *em* → em
    .replace(/^#{1,6}\s+/, "") // stray leading heading marker
    .trim();
}
