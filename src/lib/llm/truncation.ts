/**
 * Heuristic backstop for a body that was cut off at the token cap. The provider
 * flag (LlmCompletion.truncated) is the primary signal, but a module goes
 * through a second rewrite (the concreteness pass) whose truncation the caller
 * cannot see once it is parsed. This spots the tell every truncation leaves: the
 * text stops mid-sentence.
 *
 * A finished body ends on punctuation or a markdown closer (a period, a table
 * row's `|`, a closing bracket, a code fence's backtick). A cut-off one ends on
 * a letter, a digit, or a comma. Flagging is deliberately conservative: a false
 * positive only costs us a concreteness rewrite (we keep the whole draft
 * instead), while a false negative ships a module that stops in the middle.
 */
export function looksTruncated(body: string): boolean {
  const trimmed = body.trimEnd();
  if (!trimmed) return false;
  const last = trimmed[trimmed.length - 1] ?? "";
  return /[\p{L}\p{N},]/u.test(last);
}
