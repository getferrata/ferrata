"use client";

import { useState } from "react";

type Kind = "obsidian" | "package";

interface DoneData {
  path?: string;
  dir?: string;
  file?: string;
  fileCount?: number;
}

const BTN =
  "inline-flex min-h-[36px] items-center self-start rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50";

/**
 * The reason a request was refused, out of the body rather than off the status.
 *
 * An export can be refused for a reason worth reading: the package would carry
 * a value the protection rules hold back, and which one. "Error 409" throws
 * that away and leaves the author with a number to guess from.
 */
async function reasonFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim() !== "") {
      return body.error;
    }
  } catch {
    // Not JSON, or empty. Fall through to the status, which is all there is.
  }
  return `The server refused the export (${res.status}).`;
}

/** Filename the server named, or a sensible one if it named none. */
function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? fallback;
}

/**
 * Course export. The portable `.ferrata` package downloads to the browser, the
 * Obsidian vault is a directory written on the host machine (a local-install
 * convenience), so that one keeps the POST and reports a path.
 */
export function ExportButton({
  courseId,
  kind,
}: {
  courseId: string;
  kind: Kind;
}) {
  if (kind === "package") return <PackageExport courseId={courseId} />;
  return <ObsidianExport courseId={courseId} />;
}

/**
 * Fetched rather than linked, which is the whole point of this component.
 *
 * A plain download link hands the response to the browser, and a browser given
 * a refusal renders its own network error page: the author saw "409 Conflict"
 * over a picture of a fox, and the sentence naming the protected value that
 * caused it was in a body nothing displayed. The reason is the entire value of
 * refusing, so the refusal has to come back into the page.
 */
function PackageExport({ courseId }: { courseId: string }) {
  const [state, setState] = useState<
    { s: "idle" } | { s: "working" } | { s: "error"; message: string }
  >({ s: "idle" });

  async function run() {
    setState({ s: "working" });
    try {
      const res = await fetch(`/api/courses/${courseId}/package`);
      if (!res.ok) {
        setState({ s: "error", message: await reasonFrom(res) });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res, "course.ferrata.json");
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next turn: the click has to have started the save
      // before the object url stops resolving.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState({ s: "idle" });
    } catch (err) {
      setState({
        s: "error",
        message:
          err instanceof Error ? err.message : "The export could not be started.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state.s === "working"}
        className={BTN}
      >
        {state.s === "working" ? "Packaging…" : "Export Ferrata package"}
      </button>
      <p className="text-step--1 text-text-muted">
        A <code className="mono">.ferrata.json</code> file to move and import
        from <code className="mono">/import</code>. Protected values stay
        behind: addresses and internal hostnames travel as placeholders, and the
        file carries nothing that resolves them.
      </p>
      {state.s === "error" ? (
        <p role="alert" className="text-step--1 text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function ObsidianExport({ courseId }: { courseId: string }) {
  const [state, setState] = useState<
    | { s: "idle" }
    | { s: "working" }
    | { s: "done"; data: DoneData }
    | { s: "error"; message: string }
  >({ s: "idle" });

  async function run() {
    setState({ s: "working" });
    try {
      const res = await fetch(`/api/courses/${courseId}/export`, {
        method: "POST",
      });
      if (!res.ok) {
        setState({ s: "error", message: await reasonFrom(res) });
        return;
      }
      setState({ s: "done", data: (await res.json()) as DoneData });
    } catch (err) {
      setState({
        s: "error",
        message: err instanceof Error ? err.message : "Error",
      });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state.s === "working"}
        className={BTN}
      >
        {state.s === "working" ? "Exporting…" : "Export as Obsidian vault"}
      </button>
      {state.s === "done" ? (
        <p className="text-step--1 text-state-solid">
          {state.data.fileCount} notes in{" "}
          <code className="mono">{state.data.path ?? state.data.dir}</code>. Open
          that folder as a vault in Obsidian.
        </p>
      ) : null}
      {state.s === "error" ? (
        <p role="alert" className="text-step--1 text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
