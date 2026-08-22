/**
 * Show what an author gave a course, and what the system made of it.
 *
 * The question this answers is the one that comes up the moment a plan looks
 * wrong: did it ignore me, or did I say something else than I remember? Those
 * two have opposite fixes and look identical from the plan alone, and nobody
 * recalls the exact words they typed into an interview twenty minutes ago.
 *
 *   pnpm course:context                 # list courses, newest first
 *   pnpm course:context <course-id>     # what went in, and what came out
 *
 * With FERRATA_TRACE_DIR set it also says, per stage, whether the author's
 * answers were actually in the prompt. That separates a wiring bug from a
 * disagreement, which is the distinction the plan alone cannot show.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  cuts as cutsT,
  jobs as jobsT,
} from "@/db/schema";
import { describeFigures } from "@/lib/sources/figures";
import { getCourseBundle } from "@/lib/course/query";
import { isWellKnownAddress } from "@/lib/sources/well-known";
import { loadLocalEnv } from "@/lib/env";

function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function block(title: string, body: string | null | undefined): void {
  say();
  say(`--- ${title} ${"-".repeat(Math.max(0, 66 - title.length))}`);
  const text = (body ?? "").trim();
  say(text === "" ? "(empty)" : text);
}

function list(): void {
  const rows = db
    .select({
      id: coursesT.id,
      title: coursesT.title,
      status: coursesT.status,
      createdAt: coursesT.createdAt,
    })
    .from(coursesT)
    .orderBy(desc(coursesT.createdAt))
    .limit(20)
    .all();

  if (rows.length === 0) {
    say("No courses yet.");
    return;
  }
  say("Pass one of these ids:");
  say();
  for (const r of rows) {
    say(`  ${r.id}  ${r.status.padEnd(10)}  ${r.title.slice(0, 60)}`);
  }
}

/**
 * If a trace was recorded, say which stages saw the author's answers.
 *
 * This is the half the plan cannot show. When a course does the opposite of
 * what it was told there are three explanations and one appearance: the
 * instruction never reached the prompt, reached it and was misread, or reached
 * it and was overruled. The first is a wiring bug and the other two are not,
 * and this separates them by looking rather than reasoning.
 *
 * Matched on a distinctive line of the answers rather than the whole text,
 * because the prompt holds a rendered version and not a copy.
 */
function trace(courseId: string, authorContext: string | null): void {
  const dir = process.env.FERRATA_TRACE_DIR?.trim();
  if (!dir) {
    say();
    say("--- The prompts ".padEnd(70, "-"));
    say("Not recorded. Set FERRATA_TRACE_DIR to a directory and rebuild the");
    say("course to capture what each stage was asked and what it answered.");
    return;
  }

  const file = resolve(dir, `${courseId}.jsonl`);
  if (!existsSync(file)) {
    say();
    say("--- The prompts ".padEnd(70, "-"));
    say(`Tracing is on but ${file} does not exist: this course was built`);
    say("before it was switched on.");
    return;
  }

  const entries = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { task: string; ok: boolean; reason: string | null; system: string });

  // The longest line of the answers, which is the one least likely to appear
  // by chance in a prompt that never received them.
  const needle: string | null =
    (authorContext ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 25)
      .sort((a, b) => b.length - a.length)[0] ?? null;

  say();
  say(`--- The prompts (${entries.length} calls) ${"-".repeat(38)}`);
  const seen = new Map<string, { calls: number; discarded: number; sawContext: boolean }>();
  for (const e of entries) {
    const at = seen.get(e.task) ?? { calls: 0, discarded: 0, sawContext: false };
    at.calls += 1;
    if (!e.ok) at.discarded += 1;
    if (needle && e.system.includes(needle)) at.sawContext = true;
    seen.set(e.task, at);
  }
  for (const [task, s] of seen) {
    const context = !needle
      ? "no answers to look for"
      : s.sawContext
        ? "saw your answers"
        : "DID NOT see your answers";
    say(`  ${task.padEnd(20)} ${String(s.calls).padStart(3)} calls, ${s.discarded} discarded  ·  ${context}`);
  }
  say();
  say(`Full text of every call: ${file}`);
}

/**
 * Why an approved picture is not showing, which has two answers and one look.
 *
 * A picture reaches a reader in two steps: a module body has to carry its
 * token, and the picture has to be approved. Miss either and the page looks the
 * same, but the fixes are opposite. No token means the writing stage dropped
 * it, and only a rewrite puts it back, which costs a call. Token but no
 * approval is a click and costs nothing. Guessing between them either wastes
 * money or wastes an afternoon.
 */
function pictures(courseId: string): void {
  const figs = describeFigures(courseId);
  say();
  say(`--- Pictures (${figs.length}) ${"-".repeat(48)}`);
  if (figs.length === 0) {
    say("None were found in the material.");
    return;
  }
  for (const f of figs) {
    const placed = f.usedBy.length > 0;
    const verdict = placed
      ? f.status === "approved"
        ? "shows in: " + f.usedBy.join(", ")
        : `in ${f.usedBy.join(", ")} but ${f.status}: approve it and it appears`
      : f.status === "approved"
        ? "approved but NO MODULE CARRIES ITS TOKEN: the writing stage dropped it, and only a rewrite of the module that should show it will put it back"
        : "not placed and not approved";
    say(`  ${f.token}  from "${f.sourceName}"`);
    say(`    ${verdict}`);
  }
}

/**
 * What the worker has been asked to do for this course, and how it went.
 *
 * "I clicked it and nothing happened" needs an answer, and until now there was
 * none short of opening the database. A queued job that never ran, one that
 * failed with a reason, and one that finished and changed nothing are three
 * different situations that look the same from the page, and only the third is
 * about the model.
 */
function work(courseId: string): void {
  const rows = db
    .select({
      type: jobsT.type,
      status: jobsT.status,
      attempts: jobsT.attempts,
      error: jobsT.error,
      updatedAt: jobsT.updatedAt,
      payloadJson: jobsT.payloadJson,
    })
    .from(jobsT)
    .orderBy(desc(jobsT.updatedAt))
    .limit(200)
    .all()
    .filter((j) => j.payloadJson.includes(courseId))
    .slice(0, 12);

  say();
  say(`--- Recent work (${rows.length}) ${"-".repeat(44)}`);
  if (rows.length === 0) {
    say("Nothing queued for this course. If you clicked something and expected");
    say("a change, the click did not reach the server.");
    return;
  }
  for (const j of rows) {
    const when = new Date(j.updatedAt).toISOString().slice(0, 19).replace("T", " ");
    say(`  ${when}  ${j.type.padEnd(20)} ${j.status}${j.attempts > 1 ? ` (${j.attempts} attempts)` : ""}`);
    if (j.error) say(`      ${j.error.slice(0, 160)}`);
  }
}

/**
 * Why the export refuses, in enough detail to decide whether it is right.
 *
 * The guard stops a package that would carry a protected value in clear, and
 * names the labels, which is correct for a message that might be read by
 * somebody who should not see the values. The author deciding what to do needs
 * the opposite: the value itself and where it appears. "Internal hostname"
 * could be a leak worth stopping or an RFC example address the model wrote by
 * itself while explaining private ranges, and those need opposite answers.
 *
 * Only run by the owner, on their own machine, against their own course.
 */
function protectedValues(id: string): void {
  const bundle = getCourseBundle(id);
  if (!bundle || bundle.restorations.length === 0) return;

  const bodies = bundle.modules.flatMap((m) =>
    m.module?.bodyMd ? [{ title: m.concept.title, text: m.module.bodyMd }] : [],
  );

  say();
  say(`--- Protected values (${bundle.restorations.length}) ${"-".repeat(36)}`);
  let leaking = 0;
  for (const r of bundle.restorations) {
    if (r.value === "") {
      say(`  ${r.label}: sealed, and FERRATA_SECRET_KEY is not set here`);
      continue;
    }
    const inClear = bodies.filter((b) => b.text.includes(r.value));
    if (inClear.length === 0) continue;
    if (isWellKnownAddress(r.value)) {
      // Named, not hidden: the author should see that something decided to
      // protect it and that the export knows better.
      say(`  ${r.label}: ${r.value}`);
      say("    published in an RFC, so the export lets it through");
      continue;
    }
    leaking += 1;
    say(`  ${r.label}: ${r.value}`);
    say(`    written out in clear by: ${inClear.map((b) => b.title).join(", ")}`);
  }
  if (leaking === 0) {
    say("  None appear in clear in any module. The export will not refuse.");
    return;
  }
  say();
  say(`The export refuses while any of the ${leaking} above stands. Each is one`);
  say("of two things. A value the model was never shown and wrote anyway is a");
  say("coincidence, usually a textbook address, and the module can keep it: edit");
  say("the module so the wording differs from the protected value. A value that");
  say("came from your material really would travel in the package, and the");
  say("refusal is doing its job.");
}

function show(id: string): void {
  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) {
    say(`No course with id ${id}.`);
    process.exitCode = 1;
    return;
  }

  say(`${course.title}`);
  say(`${course.status} · ${course.lang} · budget ${course.budgetMinutes ?? "unset"} min`);

  say();
  say("=== WHAT YOU GAVE IT ".padEnd(72, "="));
  block("The brief, as you typed it", course.sourcePrompt);
  // The interview answers, which is where a plan usually goes wrong: an answer
  // that reads clearly to a person can still be ambiguous on the page.
  block("Your interview answers", course.authorContextMd);

  say();
  say("=== WHAT IT MADE OF THAT ".padEnd(72, "="));
  block("Objective it wrote for itself", course.objective);
  block("Concreteness rule it will hold each module to", course.concretenessRule);
  block("Starting level it settled on", course.startLevel);

  const kept = db
    .select({ title: conceptsT.title, summary: conceptsT.summary })
    .from(conceptsT)
    .where(eq(conceptsT.courseId, id))
    .orderBy(conceptsT.topoOrder)
    .all();

  say();
  say(`--- Concepts kept (${kept.length}) ${"-".repeat(40)}`);
  for (const c of kept) {
    say(`  • ${c.title}`);
    say(`    ${c.summary.slice(0, 150)}`);
  }

  const cut = db
    .select({ title: cutsT.title, reason: cutsT.reason })
    .from(cutsT)
    .where(eq(cutsT.courseId, id))
    .all();

  say();
  say(`--- Cut, and why (${cut.length}) ${"-".repeat(44)}`);
  for (const c of cut) {
    say(`  • ${c.title}`);
    say(`    ${c.reason}`);
  }

  work(id);
  pictures(id);
  protectedValues(id);
  trace(id, course.authorContextMd);

  say();
  say("Read the two halves against each other. An instruction in the answers");
  say("that no concept reflects was either not understood or overruled, and");
  say("either way it is worth fixing before paying to build the modules.");
}

loadLocalEnv();

const id = process.argv[2];
if (id) show(id);
else list();
