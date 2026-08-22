import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "@/db";
import { llmCalls } from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { getLogger } from "@/lib/log";
import { extractJson } from "./json";
import { estimateCostUsd, isPriceKnown } from "./cost";
import { resolveTask, type TaskName } from "./registry";
import { currentActor } from "./actor";
import { assertWithinLimit, creditsFor, reserveCredits } from "./credits";
import {
  LlmCallError,
  systemText,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmMessage,
  type LlmProvider,
  type LlmSystem,
} from "./provider";
import { traceCall, tracing } from "./trace";

const log = getLogger("llm");

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Free tiers (e.g. Groq's 12k tokens/minute) return 429 constantly under a burst
// of module writes. Honour the wait the API asks for and retry, so generation
// just slows down instead of failing. Separate from schema-parse retries.
const RATE_LIMIT_RETRIES = 8;
const MAX_BACKOFF_MS = 30_000;
// If the API asks us to wait longer than this, it's a daily/hard cap, not a
// per-minute burst: retrying is pointless, fail fast with a clear message.
const GIVE_UP_WAIT_MS = 120_000;

async function completeWithBackoff(
  provider: LlmProvider,
  req: LlmCompletionRequest,
  model: string,
): Promise<LlmCompletion> {
  for (let i = 0; ; i++) {
    try {
      return await provider.complete(req, model);
    } catch (err) {
      const rateLimited =
        err instanceof LlmCallError && err.status === 429;
      if (!rateLimited || i >= RATE_LIMIT_RETRIES) throw err;
      const suggested = err.retryAfterMs ?? 2_000 * (i + 1);
      // Daily cap (retry-after ~1h): don't burn retries waiting. Surface it.
      if (suggested > GIVE_UP_WAIT_MS) throw err;
      await sleep(Math.min(suggested, MAX_BACKOFF_MS) + 250);
    }
  }
}

/**
 * Output tokens assumed for a stage that names no cap of its own. Only ever
 * used for the pre-call reservation, never to limit anything.
 */
const DEFAULT_OUTPUT_ESTIMATE = 4_000;

/**
 * Roughly how many input tokens a prompt is worth, at the usual four
 * characters per token.
 *
 * Deliberately crude. This feeds the credit reservation held for the seconds a
 * call is in flight, and it is replaced by the provider's real token count the
 * moment the call returns. Being approximately right for that window is the
 * whole requirement; a tokenizer per provider would be a dependency bought for
 * nothing.
 */
function estimateTokens(system: LlmSystem, messages: LlmMessage[]): number {
  const chars =
    systemText(system).length +
    messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4);
}

/** Simple {{name}} interpolation for prompt templates. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt variable missing: ${key}`);
    return vars[key] ?? "";
  });
}

/**
 * The line a prompt uses to say where it stops being the same on every call.
 * Everything above it is the cache prefix; everything below changes per call.
 */
export const PER_CALL_MARKER = "---PER-CALL---";

/**
 * Split a rendered prompt at its marker.
 *
 * The marker is also the opt-in: a prompt without one is sent as a plain string
 * and no cache is asked for. That default is deliberate rather than lazy. A
 * cache write costs a quarter more than an uncached call and only pays back
 * when something reads it, so switching caching on for a stage that runs once
 * per course, as intake and the glossary do, would make the course dearer while
 * looking like an optimisation. Only the stages that run once per module carry
 * the marker.
 */
export function splitPrompt(rendered: string): LlmSystem {
  const at = rendered.indexOf(PER_CALL_MARKER);
  if (at === -1) return rendered;
  return {
    stable: rendered.slice(0, at).trimEnd(),
    perCall: rendered.slice(at + PER_CALL_MARKER.length).trimStart(),
  };
}

export interface RunStructuredOptions<T> {
  task: TaskName;
  /** Absolute path to the prompt .md (kept beside the task code, never inline). */
  promptPath: string;
  /** Variables interpolated into the prompt template. */
  vars: Record<string, string>;
  // Input typed as unknown, not as T: a schema is free to fill in a default or
  // clamp a list, so what it accepts off the wire is not what it hands back.
  // Tying the two together would forbid exactly the tolerance that keeps a
  // cosmetic omission from costing a whole billed call.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Extra user turns appended after the rendered prompt (e.g. prior attempt). */
  extraMessages?: LlmMessage[];
  courseId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Parse-failure retries (each re-prompts with the validation error). */
  maxRetries?: number;
  /**
   * Ask the provider for JSON mode. Default true. A long-form task that speaks a
   * delimiter format (see `parse`) turns this off, since its body is not JSON.
   */
  jsonMode?: boolean;
  /** How to turn completion text into the value to validate. Default: JSON. */
  parse?: (text: string) => unknown;
  /**
   * A last pass over the parsed value before it meets the schema, for shapes a
   * model gets wrong in ways that are unambiguous to correct.
   *
   * Per task rather than global: what is safe to rewrite depends entirely on
   * what the field means, and a blanket coercion would turn a real defect into
   * a silent one somewhere else. Whatever it changes is logged, since a model
   * drifting further off spec each week must not look like a model that is
   * fine.
   */
  repair?: (parsed: unknown) => { value: unknown; notes: string[] };
  /** Name of the output format, used in repair prompts. Default "JSON". */
  formatName?: string;
}

/**
 * Run one structured LLM task end to end: load the prompt, call the per-task
 * provider, validate the output against a Zod schema, retry on parse/validation
 * failure, and record token/cost in llm_calls.
 */
export async function runStructuredTask<T>(
  opts: RunStructuredOptions<T>,
): Promise<T> {
  const { provider, providerName, model } = resolveTask(opts.task);
  const template = await readFile(opts.promptPath, "utf8");
  const system = splitPrompt(render(template, opts.vars));

  const actorId = currentActor()?.userId ?? null;
  const maxRetries = opts.maxRetries ?? 2;
  const jsonMode = opts.jsonMode ?? true;
  const parse = opts.parse ?? extractJson;
  const formatName = opts.formatName ?? "JSON";
  const messages: LlmMessage[] = [
    { role: "user", content: "Produce the output now." },
    ...(opts.extraMessages ?? []),
  ];

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Checked on every attempt, not once: a long repair loop must not be able
    // to walk past the ceiling one retry at a time.
    assertWithinLimit(actorId);
    // What this attempt is expected to cost, held against the actor until the
    // real figure lands in the ledger below. It is what makes the check above
    // true for the calls running beside this one rather than only for the ones
    // that have already finished.
    const release = reserveCredits(
      actorId,
      creditsFor(
        estimateCostUsd(
          providerName,
          model,
          estimateTokens(system, messages),
          opts.maxTokens ?? DEFAULT_OUTPUT_ESTIMATE,
        ),
      ),
    );
    const startedAt = now();
    let ok = false;
    let tokensIn = 0;
    let tokensOut = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    // Why this attempt was thrown away, for the ledger row below. Per attempt,
    // not shared with lastError: a discarded call has to carry its own reason
    // or the receipt says a third of a course was wasted without saying on what.
    let reason: string | null = null;
    // Held only so the trace below can see it. Empty when the call never
    // returned, which is itself worth recording.
    let responseText = "";
    try {
      const completion = await completeWithBackoff(
        provider,
        {
          system,
          messages,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          jsonMode,
        },
        model,
      );
      responseText = completion.text;
      tokensIn = completion.usage.tokensIn;
      tokensOut = completion.usage.tokensOut;
      cacheReadTokens = completion.usage.cacheReadTokens ?? 0;
      cacheWriteTokens = completion.usage.cacheWriteTokens ?? 0;

      let parsed = parse(completion.text);
      if (opts.repair) {
        const repaired = opts.repair(parsed);
        parsed = repaired.value;
        if (repaired.notes.length > 0) {
          log.warn(
            `Task "${opts.task}" output was repaired rather than retried: ${repaired.notes.join("; ")}`,
          );
        }
      }
      const result = opts.schema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        reason = `schema: ${lastError}`;
        // Said out loud for the same reason as the cap below: this is a whole
        // billed call being discarded, and a rule that rejects a good answer
        // for a cosmetic reason is worth seeing rather than paying for twice.
        log.warn(
          `Task "${opts.task}" output failed validation, retrying at a cost of one more call: ${lastError}`,
        );
        // Feed the error back so the model can repair on the next attempt.
        messages.push(
          { role: "assistant", content: completion.text },
          {
            role: "user",
            content: `That output failed validation: ${lastError}. Return corrected ${formatName} only.`,
          },
        );
        continue;
      }
      // Parsed clean, but the model may have been cut off at the token cap:
      // json-repair closes a half-written object, so a body ending mid-sentence
      // still validates. Retry (asking for a complete, tighter answer) while
      // attempts remain; on the last attempt keep the salvaged result rather than
      // failing the whole course over it, and log so it is visible.
      if (completion.truncated && attempt < maxRetries) {
        lastError = "output hit the token cap (truncated)";
        reason = `truncated at the ${opts.maxTokens ?? "default"}-token cap`;
        // Said out loud, because this is the expensive branch and it used to be
        // silent: the retry is a whole extra call carrying the first one's
        // output back with it. A stage that logs this routinely has a ceiling
        // set too low, not a model behaving badly (see tasks/caps.ts).
        log.warn(
          `Task "${opts.task}" hit its ${opts.maxTokens ?? "default"}-token output cap; retrying at a cost of one more call`,
        );
        messages.push(
          { role: "assistant", content: completion.text },
          {
            role: "user",
            content: `Your previous output was cut off before it finished. Return the complete ${formatName}, tightening the prose if needed so the whole value fits.`,
          },
        );
        continue;
      }
      if (completion.truncated) {
        log.warn(
          `Task "${opts.task}" output still truncated after ${maxRetries + 1} attempts; accepting the salvaged result`,
        );
      }
      ok = true;
      return result.data;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      reason = `transport: ${lastError}`;
      // Transport errors are not repairable by re-prompting; rethrow last one.
      if (attempt === maxRetries) throw err;
    } finally {
      const costUsd = estimateCostUsd(providerName, model, tokensIn, tokensOut, {
        readTokens: cacheReadTokens,
        writeTokens: cacheWriteTokens,
      });
      db.insert(llmCalls)
        .values({
          priceKnown: isPriceKnown(providerName, model),
          id: newId("llm"),
          courseId: opts.courseId ?? null,
          userId: actorId,
          task: opts.task,
          provider: providerName,
          model,
          tokensIn,
          tokensOut,
          cacheReadTokens,
          cacheWriteTokens,
          costUsd,
          credits: creditsFor(costUsd),
          latencyMs: now() - startedAt,
          ok,
          error: ok ? null : reason,
        })
        .run();
      // Written after the ledger and only when an operator asked for it. This
      // is the half the ledger cannot hold: what was said, rather than what it
      // cost to say it. Never allowed to interrupt the build.
      if (tracing()) {
        traceCall({
          task: opts.task,
          provider: providerName,
          model,
          courseId: opts.courseId ?? null,
          userId: actorId,
          attempt,
          system: systemText(system),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          response: responseText,
          tokensIn,
          tokensOut,
          costUsd,
          ok,
          reason: ok ? null : reason,
          at: startedAt,
        });
      }
      // After the ledger row, never before: releasing first would leave a gap
      // in which this call is accounted for by neither.
      release();
    }
  }

  throw new Error(
    `Task "${opts.task}" failed after ${maxRetries + 1} attempts: ${lastError}`,
  );
}
