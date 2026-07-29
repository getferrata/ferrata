import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal leveled logger with optional size-based file rotation.
 *
 * Console output is always on. File output activates when FERRATA_LOG_DIR is
 * set: lines are appended to <dir>/ferrata.log and rotated by size, keeping a
 * fixed number of older files (ferrata.log.1 ... ferrata.log.N).
 *
 * Env:
 *   FERRATA_LOG_LEVEL     debug | info | warn | error | silent  (default: info)
 *   FERRATA_LOG_DIR       directory for log files       (default: unset, console only)
 *   FERRATA_LOG_MAX_KB    rotate when file exceeds this (default: 5120)
 *   FERRATA_LOG_KEEP      rotated files to keep         (default: 5)
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

// `silent` sits above every real level, so nothing is ever at or over it. It
// exists for the test suite: several tests deliberately drive failure paths that
// the code is right to log, and a passing run that prints ERROR lines reads as a
// broken one to anybody who has not memorised which failures are on purpose.
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 99,
};

const FILE_NAME = "ferrata.log";

interface FileSinkConfig {
  dir: string;
  maxBytes: number;
  keep: number;
}

function threshold(): number {
  const raw = (process.env.FERRATA_LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_RANK[(raw in LEVEL_RANK ? raw : "info") as LogLevel];
}

function fileSink(): FileSinkConfig | null {
  const dir = process.env.FERRATA_LOG_DIR;
  if (!dir) return null;
  const maxKb = Number(process.env.FERRATA_LOG_MAX_KB ?? "5120");
  const keep = Number(process.env.FERRATA_LOG_KEEP ?? "5");
  return {
    dir,
    maxBytes: (Number.isFinite(maxKb) && maxKb > 0 ? maxKb : 5120) * 1024,
    keep: Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : 5,
  };
}

/** Shift ferrata.log -> .1 -> .2 ... dropping the oldest beyond `keep`. */
export function rotate(dir: string, keep: number): void {
  const oldest = join(dir, `${FILE_NAME}.${keep}`);
  if (existsSync(oldest)) rmSync(oldest);
  for (let i = keep - 1; i >= 1; i--) {
    const from = join(dir, `${FILE_NAME}.${i}`);
    if (existsSync(from)) renameSync(from, join(dir, `${FILE_NAME}.${i + 1}`));
  }
  const current = join(dir, FILE_NAME);
  if (existsSync(current)) renameSync(current, join(dir, `${FILE_NAME}.1`));
}

function writeToFile(line: string): void {
  const sink = fileSink();
  if (!sink) return;
  try {
    mkdirSync(sink.dir, { recursive: true });
    const path = join(sink.dir, FILE_NAME);
    if (existsSync(path) && statSync(path).size >= sink.maxBytes) {
      rotate(sink.dir, sink.keep);
    }
    appendFileSync(path, line + "\n", "utf8");
  } catch {
    // Logging must never take the app down; console output already happened.
  }
}

function emit(scope: string, level: LogLevel, message: string, extra?: unknown): void {
  if (LEVEL_RANK[level] < threshold()) return;
  const ts = new Date().toISOString();
  const suffix = extra === undefined ? "" : ` ${safeJson(extra)}`;
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  writeToFile(line);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug: (message: string, extra?: unknown) => void;
  info: (message: string, extra?: unknown) => void;
  warn: (message: string, extra?: unknown) => void;
  error: (message: string, extra?: unknown) => void;
}

export function getLogger(scope: string): Logger {
  return {
    debug: (m, e) => emit(scope, "debug", m, e),
    info: (m, e) => emit(scope, "info", m, e),
    warn: (m, e) => emit(scope, "warn", m, e),
    error: (m, e) => emit(scope, "error", m, e),
  };
}
