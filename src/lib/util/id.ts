import { randomUUID } from "node:crypto";

/** App-generated primary key. Uses the platform UUID; no external dependency. */
export function newId(prefix?: string): string {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** Current unix epoch in milliseconds. Centralized so tests can reason about it. */
export function now(): number {
  return Date.now();
}
