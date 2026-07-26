import { z } from "zod";

/**
 * A z.enum tolerant of casing and surrounding whitespace. Small local models
 * constantly return "Critical" for "critical" or "MCQ" for "mcq". Strict enums
 * then fail schema validation and sink the whole task. This normalizes the value
 * back to the canonical casing before validating, so a trivial casing slip does
 * not cost a retry (or the course). Surfaced by the benchmark suite: qwen2.5:1.5b
 * failed intake purely on "Critical" vs "critical".
 */
export function ciEnum<const T extends readonly [string, ...string[]]>(
  values: T,
): z.ZodType<T[number]> {
  const canon = new Map(values.map((v) => [v.toLowerCase(), v] as const));
  // Normalize a string to the canonical casing (or leave it, so z.enum reports a
  // clean error), then validate. Typed as the enum union for both input and
  // output. At runtime safeParse still accepts the raw `unknown` LLM value, and
  // the explicit type keeps callers from seeing `string`/`unknown` for the field.
  const schema = z
    .string()
    .transform((v) => canon.get(v.trim().toLowerCase()) ?? v)
    .pipe(z.enum(values as unknown as [string, ...string[]]));
  return schema as unknown as z.ZodType<T[number]>;
}
