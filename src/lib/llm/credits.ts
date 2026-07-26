import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { llmCalls } from "@/db/schema";
import { getSetting } from "@/lib/settings";

/**
 * Credits: the spend control for an install.
 *
 * One credit is one US cent of estimated provider cost: an integer, so a
 * balance cannot drift the way a running sum of floats does, and the same unit
 * whichever provider a task resolves to. Local models cost nothing, so an
 * Ollama install never spends a credit.
 *
 * Spend is summed from the llm_calls ledger rather than held in a counter
 * beside it, which would be a second source of truth to keep in step. At the
 * scale one install runs at the indexed sum costs nothing.
 */

export const CREDIT_LIMIT_KEY = "FERRATA_CREDIT_LIMIT";
export const CREDIT_WINDOW_KEY = "FERRATA_CREDIT_WINDOW_DAYS";

/** Cost in USD to whole credits, rounded up so a cheap call is never free. */
export function creditsFor(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.ceil(costUsd * 100);
}

/**
 * The per-person ceiling, or null for no limit. Unset means unlimited, since
 * closed registration already bounds who can spend, and a ceiling appearing
 * mid-course would strand work in progress.
 */
export function creditLimit(): number | null {
  const raw = getSetting(CREDIT_LIMIT_KEY) ?? process.env[CREDIT_LIMIT_KEY];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** How far back spend is counted. Default 30 days, 0 for all time. */
export function creditWindowMs(): number {
  const raw = getSetting(CREDIT_WINDOW_KEY) ?? process.env[CREDIT_WINDOW_KEY];
  const days = raw ? Number(raw) : 30;
  if (!Number.isFinite(days) || days < 0) return 30 * 24 * 60 * 60 * 1000;
  return days * 24 * 60 * 60 * 1000;
}

/** Credits this user has spent inside the window. */
export function spentBy(userId: string, at: number = Date.now()): number {
  const window = creditWindowMs();
  const since = window > 0 ? at - window : 0;
  const row = db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.credits}), 0)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), gte(llmCalls.createdAt, since)))
    .get();
  return row?.total ?? 0;
}

export interface Balance {
  limit: number | null;
  spent: number;
  remaining: number | null;
}

export function balanceFor(userId: string, at: number = Date.now()): Balance {
  const limit = creditLimit();
  const spent = spentBy(userId, at);
  return {
    limit,
    spent,
    remaining: limit === null ? null : Math.max(0, limit - spent),
  };
}

/** Raised when a call would take someone past their ceiling. */
export class CreditLimitError extends Error {
  constructor(
    readonly userId: string,
    readonly spent: number,
    readonly limit: number,
  ) {
    super(
      `Credit limit reached: ${spent} of ${limit} credits used. Ask whoever runs this install to raise it.`,
    );
    this.name = "CreditLimitError";
  }
}

/**
 * Gate a call before it runs; checking afterwards would only report the
 * overspend.
 *
 * A plain balance test, not a reservation held across the call: one call costs
 * a fraction of a cent, so the worst overshoot is a single call, and a
 * reservation would leak every time a process died mid-request.
 */
export function assertWithinLimit(userId: string | null): void {
  if (!userId) return;
  const limit = creditLimit();
  if (limit === null) return;
  const spent = spentBy(userId);
  if (spent >= limit) throw new CreditLimitError(userId, spent, limit);
}
