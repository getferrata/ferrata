import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  backupConfig,
  listBackups,
  refusedReason,
  runBackup,
  secondsSinceLastBackup,
} from "@/lib/backup";

export const runtime = "nodejs";

/**
 * The backup panel's state, and a button to take one now.
 *
 * The button exists because the schedule cannot cover the moment that matters
 * most: the minute before an upgrade. That is when a real install lost a
 * finished course, and "back up now, then upgrade" is a sentence a person can
 * follow.
 *
 * The directory is never taken from the request. It comes from the
 * environment, so a caller cannot aim a copy of the whole database, password
 * hashes and provider key included, at a path they can then read.
 */

/**
 * One at a time. runBackup serializes internally, so overlapping calls are
 * correct rather than corrupt; this refuses them instead, so that holding the
 * button down queues one copy of the database rather than fifty.
 */
let inFlight: Promise<unknown> | null = null;

function state() {
  const config = backupConfig();
  return {
    dir: config.dir,
    everyHours: config.everyHours,
    keep: config.keep,
    refused: refusedReason(config.dir),
    secondsSinceLast: secondsSinceLastBackup(config.dir),
    backups: listBackups(config.dir).map((b) => ({
      // The name, not the path: the panel says the directory once above.
      name: b.file.split("/").pop() ?? b.file,
      takenAt: b.takenAt,
      bytes: b.bytes,
      verified: b.verified,
    })),
  };
}

export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  return NextResponse.json(state());
}

export async function POST(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  if (inFlight) {
    return NextResponse.json(
      { error: "a backup is already running" },
      { status: 409 },
    );
  }
  try {
    inFlight = runBackup();
    await inFlight;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backup failed" },
      { status: 500 },
    );
  } finally {
    inFlight = null;
  }
  return NextResponse.json(state());
}
