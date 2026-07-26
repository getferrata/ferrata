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
 * Course export. The portable `.ferrata` package downloads straight to the
 * browser (GET), so it works on a served install where a server path would be
 * unreachable. The Obsidian vault is a directory written on the host machine
 * (a local-install convenience), so it keeps the POST + path flow.
 */
export function ExportButton({
  courseId,
  kind,
}: {
  courseId: string;
  kind: Kind;
}) {
  if (kind === "package") {
    return (
      <div className="flex flex-col gap-1">
        <a href={`/api/courses/${courseId}/package`} download className={BTN}>
          Export Ferrata package
        </a>
        <p className="text-step--1 text-text-muted">
          A <code className="mono">.ferrata.json</code> file to move and import
          from <code className="mono">/import</code>. Protected values stay
          behind: addresses and internal hostnames travel as placeholders, and
          the file carries nothing that resolves them.
        </p>
      </div>
    );
  }
  return <ObsidianExport courseId={courseId} />;
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
      if (!res.ok) throw new Error(`Error ${res.status}`);
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
        <p className="text-step--1 text-danger">{state.message}</p>
      ) : null}
    </div>
  );
}
