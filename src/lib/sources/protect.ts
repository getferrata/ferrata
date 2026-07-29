import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { restorations } from "@/db/schema";
import { newId } from "@/lib/util/id";
import { sealSecret } from "@/lib/crypto/secrets";
import {
  scanSensitivity,
  type ContextiaMode,
  type Restoration,
  type ScanResult,
} from "./dlp";

/**
 * The DLP gate for text the author types rather than uploads: the brief, the
 * interview answers.
 *
 * Uploaded material goes through `ingestSource`, which scans it. Typed text used
 * to skip the gate entirely, and it is exactly where operational detail lands:
 * asked "where does this run?", an author answers with the real host. That value
 * then travelled into the model's prompt and into every exported package.
 *
 * Same contract as material: secrets are redacted for good, operational values
 * become ⟨cxt:hash⟩ placeholders with the real value kept locally, so the model
 * and the package see the placeholder and the student sees the value.
 */
export async function protectAuthorText(
  courseId: string,
  text: string,
  mode?: ContextiaMode,
): Promise<string> {
  if (!text.trim()) return text;
  const scan = await scanSensitivity(text, "author-context", mode);
  saveRestorations(courseId, scan.restorations);
  return scan.text;
}

/**
 * Scan without persisting, for the moment before the course row exists: the
 * brief is protected first so the real value is never written at all, and the
 * restore map is saved right after the insert.
 */
export async function scanAuthorText(
  text: string,
  mode?: ContextiaMode,
): Promise<ScanResult> {
  if (!text.trim()) {
    return { text, verdict: null, restorations: [], blocked: false };
  }
  return scanSensitivity(text, "author-context", mode);
}

export function saveRestorations(
  courseId: string,
  found: readonly Restoration[],
): void {
  for (const r of found) {
    // The same host in the brief and in an answer is one restoration, not two.
    const existing = db
      .select({ id: restorations.id })
      .from(restorations)
      .where(
        and(
          eq(restorations.courseId, courseId),
          eq(restorations.token, r.token),
        ),
      )
      .get();
    if (existing) continue;
    db.insert(restorations)
      .values({
        id: newId("cxt"),
        courseId,
        token: r.token,
        value: sealSecret(r.value),
        label: r.label,
        type: r.type,
      })
      .run();
  }
}
