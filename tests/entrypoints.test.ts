import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Default-deny inventory of every way into the app.
 *
 * The auth holes this repo has had were never wrong guards. They were missing
 * ones: a new endpoint that nobody remembered to protect. A per-endpoint test
 * cannot catch that, because writing it needs the same memory that was missing.
 *
 * So this test finds the entry points itself and fails on anything it does not
 * recognise. Adding a route with no guard breaks the build; the only way to
 * make it pass is to add a guard, or to declare the file public here with a
 * reason next to it.
 */

const APP = resolve(__dirname, "..", "src", "app");

/** Every route handler and page under src/app. */
function entryPoints(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entryPoints(full, found);
    } else if (name === "route.ts" || name === "page.tsx") {
      found.push(full);
    }
  }
  return found;
}

const GUARD = /getCurrentUser|requireUser|requireExaminer/;

/** A page counts as guarded if it or any layout above it checks the session. */
function guarded(file: string): boolean {
  if (GUARD.test(readFileSync(file, "utf8"))) return true;
  let dir = dirname(file);
  while (dir.startsWith(APP)) {
    const layout = join(dir, "layout.tsx");
    try {
      if (GUARD.test(readFileSync(layout, "utf8"))) return true;
    } catch {
      /* no layout at this level */
    }
    if (dir === APP) break;
    dir = dirname(dir);
  }
  return false;
}

/**
 * Reachable without an account, on purpose. Each entry needs a reason, because
 * writing one is the moment to notice the entry does not belong here.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "api/auth/login/route.ts": "signing in cannot require being signed in",
  "api/auth/register/route.ts": "creating the first account, or spending an invite",
  "api/auth/logout/route.ts": "clearing a cookie is safe for anyone",
  "page.tsx": "the marketing landing page",
  "maintenance/page.tsx": "shown when the database is unavailable",
};

/**
 * Modules that reach the LLM layer. Anything here spends money, so it needs an
 * actor for the ledger and the credit ceiling.
 */
const SPENDS = /runStructuredTask|runFeynman|runIntake|runInterviewQuestions|runBuildGraph|runWriteModule|runWriteQuestions|runConcretenessPass|runSchedule|runGlossary/;
const ACTOR = /withActor|currentActor/;

describe("every entry point is accounted for", () => {
  const files = entryPoints(APP);

  it("finds the app's entry points at all", () => {
    // A guard on the guard: if the walk silently returned nothing, every
    // assertion below would pass while checking exactly zero files.
    expect(files.length).toBeGreaterThan(30);
  });

  it("refuses anonymous callers unless the file is declared public", () => {
    const unguarded = files
      .map((f) => relative(APP, f))
      .filter((rel) => !(rel in PUBLIC_BY_DESIGN))
      .filter((rel) => !guarded(join(APP, rel)));

    expect(
      unguarded,
      `These entry points check no session and are not declared public.\n` +
        `Add a session check, or add them to PUBLIC_BY_DESIGN with a reason:\n` +
        unguarded.map((u) => `  ${u}`).join("\n"),
    ).toEqual([]);
  });

  it("keeps the public list honest", () => {
    // A declared-public file that no longer exists means the list is stale and
    // is quietly excusing nothing, or worse, shadowing a renamed route.
    const present = new Set(files.map((f) => relative(APP, f)));
    const stale = Object.keys(PUBLIC_BY_DESIGN).filter((p) => !present.has(p));
    expect(stale, `PUBLIC_BY_DESIGN lists files that no longer exist`).toEqual([]);
  });
});

describe("every call that spends is attributed", () => {
  it("names an actor wherever the LLM layer is reached from a request", () => {
    // The worker sets the actor for background jobs, so handlers are covered by
    // it. Anything else calling a task directly has to say who is paying, or
    // the spend lands in the ledger with no owner and no ceiling applies.
    const routes = entryPoints(APP).filter((f) => f.endsWith("route.ts"));
    const unattributed = routes.filter((f) => {
      const src = readFileSync(f, "utf8");
      return SPENDS.test(src) && !ACTOR.test(src);
    });
    expect(
      unattributed.map((f) => relative(APP, f)),
      "These routes call the model without establishing an actor",
    ).toEqual([]);
  });
});
