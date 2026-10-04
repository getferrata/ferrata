/**
 * The ceilings on what can be attached to a course, and the words used when one
 * is hit.
 *
 * They were constants copied into two route files, and hitting one gave "Error
 * 400" or nothing at all: a file over the limit was skipped without a word and the
 * course was built from whatever was left.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // one file
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // the whole request
export const MAX_FILES = 20;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface Oversize {
  name: string;
  size: number;
}

/** The files over the per-file limit, in the order given. */
export function oversizeFiles(
  files: ReadonlyArray<{ name: string; size: number }>,
  max: number = MAX_FILE_BYTES,
): Oversize[] {
  return files.filter((f) => f.size > max).map((f) => ({ name: f.name, size: f.size }));
}

export function oversizeMessage(over: readonly Oversize[], max: number = MAX_FILE_BYTES): string {
  const first = over[0]!;
  const limit = formatBytes(max);
  const rest = over.length > 1 ? ` (and ${over.length - 1} more)` : "";
  return `${first.name} is ${formatBytes(first.size)}${rest}, over the ${limit} limit for one file. Split it, or attach a smaller version.`;
}

export const TOTAL_TOO_LARGE_MESSAGE = `The files add up to more than ${formatBytes(MAX_TOTAL_BYTES)}. Remove some, or add them to the course in a second step.`;

export const NOT_A_FORM_MESSAGE =
  "That upload could not be read. Reload the page and try again.";
