import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceCall, traceDir, tracing, type TraceEntry } from "@/lib/llm/trace";

/**
 * The trace exists because the ledger cannot answer the question people
 * actually ask. It knows a course cost four dollars and sixty seven cents; it
 * does not know that the author asked for mental arithmetic and the plan came
 * back saying a calculator is fine. Whether that instruction never reached the
 * prompt, reached it and was misread, or reached it and was overruled has three
 * different fixes and, from outside, one appearance.
 *
 * Two properties matter more than the format. It is off unless somebody turns
 * it on, because a prompt carries the material and nobody enabling a debugging
 * aid agreed to a second copy of their documents. And it never interrupts a
 * build, because the one unacceptable outcome is a diagnostic taking down the
 * thing being diagnosed.
 */

const entry = (over: Partial<TraceEntry> = {}): TraceEntry => ({
  task: "intake",
  provider: "anthropic",
  model: "claude-sonnet-5",
  courseId: "course_1",
  userId: "user_1",
  attempt: 0,
  system: "You are the intake stage. The author said: calcolo a mente.",
  messages: [{ role: "user", content: "Produce the output now." }],
  response: '{"objective":"..."}',
  tokensIn: 100,
  tokensOut: 50,
  costUsd: 0.01,
  ok: true,
  reason: null,
  at: 1_700_000_000_000,
  ...over,
});

let dir = "";
const previous = process.env.FERRATA_TRACE_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ferrata-trace-"));
  delete process.env.FERRATA_TRACE_DIR;
});

afterEach(() => {
  if (previous === undefined) delete process.env.FERRATA_TRACE_DIR;
  else process.env.FERRATA_TRACE_DIR = previous;
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe("off unless asked for", () => {
  it("is off when nothing is configured", () => {
    expect(tracing()).toBe(false);
    expect(traceDir()).toBeNull();
  });

  it("writes nothing at all when off", () => {
    traceCall(entry());
    expect(readdirSync(dir)).toEqual([]);
  });

  it("treats an empty setting as off, not as the working directory", () => {
    // Otherwise `FERRATA_TRACE_DIR=` in a shell script silently starts writing
    // prompts into wherever the server happens to have been started from.
    process.env.FERRATA_TRACE_DIR = "   ";
    expect(tracing()).toBe(false);
  });
});

describe("what it records when it is on", () => {
  beforeEach(() => {
    process.env.FERRATA_TRACE_DIR = dir;
  });

  it("keeps the prompt and the answer, which is the whole point", () => {
    traceCall(entry());
    const written = JSON.parse(
      readFileSync(join(dir, "course_1.jsonl"), "utf8").trim(),
    ) as TraceEntry;
    expect(written.system).toContain("calcolo a mente");
    expect(written.response).toContain("objective");
    expect(written.task).toBe("intake");
  });

  it("groups by course, since the question is always about one course", () => {
    traceCall(entry({ courseId: "course_1" }));
    traceCall(entry({ courseId: "course_2" }));
    expect(readdirSync(dir).sort()).toEqual(["course_1.jsonl", "course_2.jsonl"]);
  });

  it("appends rather than replaces, because modules generate in parallel", () => {
    traceCall(entry({ task: "write_module" }));
    traceCall(entry({ task: "write_questions" }));
    const lines = readFileSync(join(dir, "course_1.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("records a discarded attempt with its reason, like the ledger does", () => {
    traceCall(entry({ ok: false, reason: "schema: depthLevel: expected number" }));
    const written = JSON.parse(
      readFileSync(join(dir, "course_1.jsonl"), "utf8").trim(),
    ) as TraceEntry;
    expect(written.ok).toBe(false);
    expect(written.reason).toContain("depthLevel");
  });

  it("has somewhere to put a call that belongs to no course", () => {
    traceCall(entry({ courseId: null }));
    expect(readdirSync(dir)).toEqual(["no-course.jsonl"]);
  });
});

describe("it cannot take a build down", () => {
  it("swallows an unwritable directory instead of throwing", () => {
    // A path under a regular file cannot be created. Whatever the cause, a
    // trace that fails is a missing diagnostic and not a failed course.
    process.env.FERRATA_TRACE_DIR = join(__filename, "nested");
    expect(() => traceCall(entry())).not.toThrow();
  });
});
