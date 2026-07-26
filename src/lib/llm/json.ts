import { jsonrepair } from "jsonrepair";

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Isolate the JSON region: from the first `{`/`[` to its balanced close. If the
 * output was truncated (the model hit the token cap mid-object), the brackets
 * never balance, so we return everything from the first bracket to the end and
 * let the repair pass close it.
 */
function jsonRegion(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced: truncated output. Hand the tail to the repair pass.
  return text.slice(start);
}

/**
 * Extract a single JSON value from model output, repairing the malformations
 * small local models routinely produce. Layered cheapest-first so well-formed
 * output takes the fast path:
 *   1. parse as-is
 *   2. strip a ```json fence and parse its body
 *   3. isolate the first balanced object/array and parse it
 *   4. repair that region (trailing commas, single quotes, unquoted keys,
 *      Python True/False/None, comments, truncation) and parse
 * Throws only if even the repaired candidate will not parse.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  const direct = tryParse(text);
  if (direct.ok) return direct.value;

  // Prefer the content of a fenced block when present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? text;
  const fenced = tryParse(body);
  if (fenced.ok) return fenced.value;

  const region = jsonRegion(body);
  if (region === null) {
    throw new Error("No JSON object or array found in model output");
  }
  const balanced = tryParse(region);
  if (balanced.ok) return balanced.value;

  // Last resort: repair the isolated region, then parse.
  try {
    return JSON.parse(jsonrepair(region));
  } catch (err) {
    throw new Error(
      `Could not parse or repair JSON from model output: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
