import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "@/db";
import { llmCalls } from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { extractJson } from "./json";
import { estimateCostUsd } from "./cost";
import { resolveTask, type TaskName } from "./registry";
import { currentActor } from "./actor";
import { assertWithinLimit, creditsFor } from "./credits";
import {
  LlmCallError,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmMessage,
  type LlmProvider,
} from "./provider";

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

/** Simple {{name}} interpolation for prompt templates. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt variable missing: ${key}`);
    return vars[key] ?? "";
  });
}

export interface RunStructuredOptions<T> {
  task: TaskName;
  /** Absolute path to the prompt .md (kept beside the task code, never inline). */
  promptPath: string;
  /** Variables interpolated into the prompt template. */
  vars: Record<string, string>;
  schema: z.ZodType<T>;
  /** Extra user turns appended after the rendered prompt (e.g. prior attempt). */
  extraMessages?: LlmMessage[];
  courseId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Parse-failure retries (each re-prompts with the validation error). */
  maxRetries?: number;
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
  const system = render(template, opts.vars);

  const actorId = currentActor()?.userId ?? null;
  const maxRetries = opts.maxRetries ?? 2;
  const messages: LlmMessage[] = [
    { role: "user", content: "Produce the output now." },
    ...(opts.extraMessages ?? []),
  ];

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Checked on every attempt, not once: a long repair loop must not be able
    // to walk past the ceiling one retry at a time.
    assertWithinLimit(actorId);
    const startedAt = now();
    let ok = false;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const completion = await completeWithBackoff(
        provider,
        {
          system,
          messages,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          jsonMode: true,
        },
        model,
      );
      tokensIn = completion.usage.tokensIn;
      tokensOut = completion.usage.tokensOut;

      const parsed = extractJson(completion.text);
      const result = opts.schema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        // Feed the error back so the model can repair on the next attempt.
        messages.push(
          { role: "assistant", content: completion.text },
          {
            role: "user",
            content: `That output failed schema validation: ${lastError}. Return corrected JSON only.`,
          },
        );
        continue;
      }
      ok = true;
      return result.data;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Transport errors are not repairable by re-prompting; rethrow last one.
      if (attempt === maxRetries) throw err;
    } finally {
      const costUsd = estimateCostUsd(providerName, model, tokensIn, tokensOut);
      db.insert(llmCalls)
        .values({
          id: newId("llm"),
          courseId: opts.courseId ?? null,
          userId: actorId,
          task: opts.task,
          provider: providerName,
          model,
          tokensIn,
          tokensOut,
          costUsd,
          credits: creditsFor(costUsd),
          latencyMs: now() - startedAt,
          ok,
        })
        .run();
    }
  }

  throw new Error(
    `Task "${opts.task}" failed after ${maxRetries + 1} attempts: ${lastError}`,
  );
}
