"use client";

import { useCallback, useEffect, useState } from "react";

interface Entry {
  name: string;
  takenAt: number;
  bytes: number;
  verified: { courses: number; modules: number; questions: number } | null;
}

interface State {
  dir: string;
  everyHours: number;
  keep: number;
  refused: string | null;
  secondsSinceLast: number | null;
  backups: Entry[];
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ago(seconds: number): string {
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / (24 * 3600))} days ago`;
}

/**
 * Where the courses live if the machine does not.
 *
 * The panel exists because a backup nobody has looked at is a belief. It shows
 * the age of the newest copy and what reading it back found, so a schedule that
 * has quietly been failing for a fortnight looks like a failure rather than
 * like silence.
 */
export function BackupsPanel() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/backup");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setState((await res.json()) as State);
    } catch {
      setError("Could not read the backup directory.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function backupNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/backup", { method: "POST" });
      const body = (await res.json()) as State & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setState(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The backup failed.");
    } finally {
      setBusy(false);
    }
  }

  const newest = state?.backups[0];

  return (
    <section id="backups" className="mt-14 border-t border-border pt-10">
      <h2 className="font-serif text-step-2 leading-tight">Backups</h2>
      <p className="mt-3 max-w-measure text-step-0 text-text-muted">
        A copy of the whole database, taken while the app keeps running and read
        back to prove it opens. Take one before you upgrade: replacing the app
        folder without it is how a finished course gets lost, and no error is
        printed when it happens.
      </p>

      {state?.refused ? (
        <p role="alert" className="mt-4 max-w-measure text-step--1 text-danger">
          No backups are being taken: {state.refused}. Point
          FERRATA_BACKUP_DIR somewhere outside the app.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={backupNow}
          disabled={busy}
          className="min-h-[44px] rounded border border-border bg-surface px-5 text-step-0 text-text transition hover:border-text-muted disabled:opacity-60"
        >
          {busy ? "Copying…" : "Back up now"}
        </button>
        {error ? (
          <span role="alert" className="text-step--1 text-danger">
            {error}
          </span>
        ) : null}
      </div>

      {state ? (
        <>
          <p className="mt-6 text-step--1 text-text-muted">
            {state.everyHours === 0
              ? "The schedule is off (FERRATA_BACKUP_EVERY_HOURS=0). Nothing is taken on its own."
              : `Taken every ${state.everyHours} hours, keeping the newest ${state.keep}.`}{" "}
            They go in <code className="font-mono">{state.dir}</code>.
          </p>
          <p className="mt-2 text-step--1">
            {state.secondsSinceLast === null ? (
              <span className="text-state-doubt">
                No backup has been taken yet.
              </span>
            ) : (
              <span
                className={
                  state.everyHours > 0 &&
                  state.secondsSinceLast > state.everyHours * 3600 * 2
                    ? "text-danger"
                    : "text-text-muted"
                }
              >
                Last one {ago(state.secondsSinceLast)}
                {newest?.verified
                  ? `: ${newest.verified.courses} courses, ${newest.verified.modules} modules, ${newest.verified.questions} questions read back out of it.`
                  : ", never read back."}
              </span>
            )}
          </p>

          {state.backups.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-step--1">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th className="py-2 pr-4 font-normal">File</th>
                    <th className="py-2 pr-4 font-normal">Size</th>
                    <th className="py-2 font-normal">Read back</th>
                  </tr>
                </thead>
                <tbody>
                  {state.backups.map((b) => (
                    <tr key={b.name} className="border-b border-border/60">
                      <td className="py-2 pr-4 font-mono">{b.name}</td>
                      <td className="py-2 pr-4">{size(b.bytes)}</td>
                      <td className="py-2">
                        {b.verified ? (
                          `${b.verified.courses} courses, ${b.verified.modules} modules`
                        ) : (
                          <span className="text-state-doubt">not verified</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
