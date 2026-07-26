import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a stretch of work is spending on behalf of.
 *
 * Generation runs in the worker, far from the request that started it, so the
 * LLM layer cannot ask who is logged in. Threading a userId through every task
 * signature would also work, at the cost of one silent gap in the ledger per
 * forgotten argument. Instead the actor is set once where work enters the
 * system (an API route, or the worker claiming a job) and read where spend is
 * recorded.
 */

export interface Actor {
  userId: string;
}

const storage = new AsyncLocalStorage<Actor>();

export function withActor<T>(actor: Actor, fn: () => T): T {
  return storage.run(actor, fn);
}

export function currentActor(): Actor | null {
  return storage.getStore() ?? null;
}
