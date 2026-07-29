import { NextResponse } from "next/server";
import { cappedFormData } from "@/lib/http/body";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { newId } from "@/lib/util/id";
import { ingestSource } from "@/lib/sources/ingest";
import { saveRestorations, scanAuthorText } from "@/lib/sources/protect";
import { expandSeeds } from "@/lib/sources/url";
import { allowedRepoRoots, ingestRepo, repoPathAllowed } from "@/lib/sources/repo";
import { getCurrentUser } from "@/lib/auth/session";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // whole request, checked before parsing
const MAX_FILES = 20;
const MAX_PROMPT_CHARS = 20_000;
const MAX_STUDY_HOURS = 2000;

/**
 * POST /api/courses. Multipart: the author's prose (`prompt`), optional
 * constraints, and optional `files` (material to ground on). Creates the course,
 * ingests each file as a source, then kicks off the authoring interview.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Building spends on the install's provider key. The examiner pages were
  // gated on the role already, the endpoint behind them was not.
  if (user.role !== "examiner") {
    return NextResponse.json(
      { error: "only an examiner can build a course" },
      { status: 403 },
    );
  }

  // Counted off the stream rather than read from Content-Length: that header is
  // absent under chunked encoding and unverified when present, so a cap built on
  // it is skipped by anyone who omits it. This process also serves every
  // student, so one oversized upload buffered whole takes the install with it.
  const parsed = await cappedFormData(req, MAX_TOTAL_BYTES);
  if (!parsed.ok) {
    return parsed.reason === "too_large"
      ? NextResponse.json({ error: "upload too large" }, { status: 413 })
      : NextResponse.json(
          { error: "expected multipart form" },
          { status: 400 },
        );
  }
  const form = parsed.form;

  // A course needs a brief OR material, not necessarily both: with material
  // alone, the interview extracts the goal and audience instead of us
  // inventing them.
  // Capped: the brief is stored in sourcePrompt and from there is interpolated
  // into every module prompt of the whole build, so an unbounded one is paid for
  // once per module, not once.
  const prompt = String(form.get("prompt") ?? "")
    .trim()
    .slice(0, MAX_PROMPT_CHARS);
  const hasFiles = form
    .getAll("files")
    .some((f) => f instanceof File && f.size > 0);
  const hasUrls = /https?:\/\//i.test(String(form.get("urls") ?? ""));
  const repoPath = (form.get("repoPath") as string | null)?.trim() ?? "";
  const hasRepo = Boolean(repoPath);
  const hasMaterial = hasFiles || hasUrls || hasRepo;
  if (prompt.length < 10 && !hasMaterial) {
    return NextResponse.json(
      { error: "write a brief or attach at least one piece of material" },
      { status: 400 },
    );
  }
  // Refuse a repository path we cannot read, before creating anything. Until
  // this was checked here, an unreadable path was dropped in silence and the
  // author got a course built from nothing, with no idea why.
  if (repoPath) {
    if (!isAbsolute(repoPath)) {
      return NextResponse.json(
        { error: "The repository path must be absolute, for example /home/you/code/our-service." },
        { status: 400 },
      );
    }
    if (allowedRepoRoots().length === 0) {
      return NextResponse.json(
        {
          error:
            "Reading a local repository is off until an operator allows it. Set FERRATA_REPO_ROOTS to the folders Ferrata may read, for example FERRATA_REPO_ROOTS=/home/you/code, and restart.",
        },
        { status: 400 },
      );
    }
    if (!(await repoPathAllowed(repoPath))) {
      return NextResponse.json(
        {
          error: `That path is outside the folders this install may read (${allowedRepoRoots().join(", ")}). Move the checkout, or add its folder to FERRATA_REPO_ROOTS.`,
        },
        { status: 400 },
      );
    }
    try {
      const info = await stat(repoPath);
      if (!info.isDirectory()) throw new Error("not a directory");
    } catch {
      return NextResponse.json(
        { error: "No readable folder at that path on the server." },
        { status: 400 },
      );
    }
  }

  // A pasted course package is a common mistake and an expensive one: without
  // this the whole pipeline runs on it, bills the author, and produces a course
  // about a JSON file.
  if (looksLikePackage(prompt)) {
    return NextResponse.json(
      {
        error:
          "That looks like an exported Ferrata course. Use Import to bring it in: it keeps the modules and tests as they are, and costs nothing.",
      },
      { status: 400 },
    );
  }

  const effectivePrompt =
    prompt.length >= 10
      ? prompt
      : "Build an onboarding course from the attached material. Work out the goal and the audience from it, and ask about anything you cannot infer.";
  const deadline = (form.get("deadline") as string | null)?.trim() || null;
  // Validated, not just parsed: a negative budget made triage cut everything it
  // could and declare the course unfeasible, and an absurd one sailed through.
  const hoursRaw = (form.get("hours") as string | null)?.trim();
  const hoursNum = hoursRaw ? Number(hoursRaw) : NaN;
  const hours =
    Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= MAX_STUDY_HOURS
      ? hoursNum
      : null;
  const level = (form.get("level") as string | null)?.trim() || null;
  const depthRaw = (form.get("depth") as string | null)?.trim();
  const depthPreset =
    depthRaw === "overview" || depthRaw === "scratch" ? depthRaw : "operational";
  const cxtRaw = (form.get("contextia") as string | null)?.trim();
  const contextiaMode =
    cxtRaw === "off" || cxtRaw === "block" || cxtRaw === "redact"
      ? cxtRaw
      : undefined; // undefined → env default (redact)

  const parts = [effectivePrompt];
  if (hours) parts.push(`Vincolo di tempo: ho circa ${hours} ore.`);
  if (deadline) parts.push(`Scadenza: ${deadline}.`);
  if (level) parts.push(`Livello di partenza: ${level}.`);

  // The brief goes through the same gate as uploaded material: an author writing
  // "how we deploy to db-01.internal" would otherwise hand that host to the
  // model and to everyone who receives the exported package.
  const scan = await scanAuthorText(parts.join("\n\n"), contextiaMode);
  const sourcePrompt = scan.text;

  const id = newId("course");
  db.insert(courses)
    .values({
      id,
      // Intake replaces this with the real title it derives.
      title:
        prompt.length >= 10
          ? sourcePrompt.slice(0, 80)
          : "New route (from material)",
      sourcePrompt,
      origin: "local",
      ownerId: user.id,
      depthPreset,
      contextiaMode,
      budgetMinutes: hours ? Math.round(hours * 60) : undefined,
      status: "interviewing",
    })
    .run();
  // Saved after the insert: the restore map points at the course row.
  saveRestorations(id, scan.restorations);

  // Ingest attached material (best-effort; a bad file must not sink creation).
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File)
    .slice(0, MAX_FILES);
  for (const file of files) {
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await ingestSource(
        id,
        { kind: "file", name: file.name, mime: file.type || null, buf },
        contextiaMode,
      );
    } catch {
      // skip this file; the course still generates from prose + other sources
    }
  }

  // Web sources: paste one or more links (a wiki/Confluence page, a doc site)
  // instead of copy-pasting. Each is fetched server-side behind an SSRF guard,
  // extracted to text, and passes the Contextia gate. Best-effort: a bad/blocked
  // URL becomes a failed source (visible on the course page), never sinks creation.
  const seeds = String(form.get("urls") ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 20);
  // Opt-in shallow crawl: expand each seed into its same-site subpages
  // (depth 1, robots.txt honored, hard page cap). Seeds always come first.
  const crawl = String(form.get("crawl") ?? "") === "1";
  let urls = seeds;
  if (crawl && seeds.length > 0) {
    try {
      urls = await expandSeeds(seeds);
    } catch {
      urls = seeds;
    }
  }
  for (const url of urls) {
    try {
      await ingestSource(id, { kind: "url", url }, contextiaMode);
    } catch {
      // skip; the course still generates from prose + other sources
    }
  }

  // Repo onboarding: ground on a LOCAL checkout of the codebase, which
  // the operator already has on disk (sovereign: we never clone an arbitrary
  // URL server-side). The path must be absolute AND resolve inside an operator
  // allowlisted root (FERRATA_REPO_ROOTS); otherwise it's a local-file-disclosure
  // vector and we skip it. Each file passes the Contextia gate.
  if (repoPath) {
    await ingestRepo(id, repoPath, { contextiaMode });
  }

  enqueue("interview_questions", { courseId: id, actorUserId: user.id });
  return NextResponse.json({ id }, { status: 201 });
}

/** True when the brief is really an exported package someone pasted. */
function looksLikePackage(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(t) as { manifest?: { format?: unknown } };
    return parsed?.manifest?.format === "ferrata";
  } catch {
    // Truncated or slightly mangled paste: the marker is still a giveaway.
    return /"format"\s*:\s*"ferrata"/.test(t);
  }
}
