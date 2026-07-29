"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface StageReport {
  task: string;
  ok: boolean;
  calls: number;
  wasted: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  hitCap: boolean;
  cap: number | null;
  reasons?: string[];
}

interface Report {
  stages: StageReport[];
  totalUsd: number;
  totalCalls: number;
  wastedCalls: number;
  wastedUsd: number;
  verdict: "clean" | "wasteful" | "broken";
  missing: string[];
  errors: { task: string; message: string }[];
}

interface Poll {
  jobId?: string;
  status: "none" | "queued" | "running" | "done" | "failed";
  error?: string | null;
  report?: Report | null;
}

const STAGE_LABEL: Record<string, string> = {
  intake: "Reading the brief",
  build_graph: "Ordering the concepts",
  write_module: "Writing a module",
  concreteness_pass: "Making it concrete",
  eval_judge: "Judging it",
  write_questions: "Writing its tests",
  schedule: "Planning the study",
  glossary: "Building the glossary",
};

function money(usd: number): string {
  if (usd <= 0) return "free";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

/**
 * A dry run of the whole pipeline on a fixture, with the models currently
 * selected.
 *
 * The connection test says the provider replies. This says something the
 * operator actually needs: that this model holds up against these prompts. Most
 * of what a stage asks for is a convention rather than an API feature, so a
 * model can be perfectly healthy and still cost double by ignoring one.
 */
export function PreflightPanel() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (jobId?: string) => {
    try {
      const url = jobId
        ? `/api/settings/preflight?jobId=${encodeURIComponent(jobId)}`
        : "/api/settings/preflight";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Poll;
      setPoll(data);
      if (data.status === "queued" || data.status === "running") {
        timer.current = setTimeout(() => void load(data.jobId), 2000);
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/preflight", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { jobId?: string; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "could not start");
      await load(data?.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start");
      setBusy(false);
    }
  }

  const running =
    busy || poll?.status === "queued" || poll?.status === "running";
  const report = poll?.report ?? null;

  return (
    <section id="preflight" className="mt-14 border-t border-border pt-10">
      <h2 className="font-serif text-step-2 leading-tight">Try the model</h2>
      <p className="mt-3 max-w-measure text-step-0 text-text-muted">
        Builds one small module end to end, tests and all, with the models
        selected above. It answers the question the connection test cannot:
        whether this model works with Ferrata, or quietly costs double by
        answering in a shape the pipeline has to ask for twice. A few hundred
        tokens, so it is a fraction of a cent even on an expensive model.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="min-h-[44px] rounded border border-border bg-surface px-5 text-step-0 text-text transition hover:border-text-muted disabled:opacity-60"
        >
          {running ? "Running…" : "Run a test module"}
        </button>
        {running ? (
          <span className="text-step--1 text-text-muted">
            Eight calls, about a minute.
          </span>
        ) : null}
        {error ? <span className="text-step--1 text-danger">{error}</span> : null}
      </div>

      {poll?.status === "failed" && !report ? (
        <p className="mt-6 text-step--1 text-danger">
          The run did not finish: {poll.error ?? "unknown error"}
        </p>
      ) : null}

      {report ? <Verdict report={report} /> : null}
    </section>
  );
}

function Verdict({ report }: { report: Report }) {
  const tone =
    report.verdict === "clean"
      ? "text-state-solid"
      : report.verdict === "wasteful"
        ? "text-state-doubt"
        : "text-danger";
  const headline =
    report.verdict === "clean"
      ? "This model works with Ferrata."
      : report.verdict === "wasteful"
        ? "It works, but it is paying for calls it throws away."
        : "This model did not get through the pipeline.";

  return (
    <div className="mt-8">
      <p className={`text-step-0 ${tone}`}>{headline}</p>
      <p className="mt-1 text-step--1 text-text-muted">
        {report.totalCalls} calls, {money(report.totalUsd)}
        {report.wastedCalls > 0
          ? `, of which ${report.wastedCalls} discarded (${money(report.wastedUsd)})`
          : ", none discarded"}
        .
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-step--1">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="py-2 pr-4 font-normal">Stage</th>
              <th className="py-2 pr-4 font-normal">Calls</th>
              <th className="py-2 pr-4 font-normal">Longest answer</th>
              <th className="py-2 font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {report.stages.map((s) => (
              <tr key={s.task} className="border-b border-border/60">
                <td className="py-2 pr-4">
                  <span className={s.ok ? "" : "text-danger"}>
                    {s.ok ? "" : "✗ "}
                    {STAGE_LABEL[s.task] ?? s.task}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  {s.calls}
                  {s.wasted > 0 ? (
                    <span className="text-state-doubt"> ({s.wasted} wasted)</span>
                  ) : null}
                </td>
                <td className="py-2 pr-4">
                  {s.tokensOut} tokens
                  {s.hitCap ? (
                    <span className="text-state-doubt"> (hit the ceiling)</span>
                  ) : null}
                </td>
                <td className="py-2">{money(s.costUsd)}</td>
              </tr>
            ))}
            {report.stages
              .filter((s) => s.reasons?.length)
              .map((s) => (
                <tr key={`${s.task}-why`} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-text-muted">
                    why {(STAGE_LABEL[s.task] ?? s.task).toLowerCase()} paid twice
                  </td>
                  <td className="py-2 text-state-doubt" colSpan={3}>
                    {s.reasons?.join(" / ")}
                  </td>
                </tr>
              ))}
            {report.missing.map((task) => (
              <tr key={task} className="border-b border-border/60 text-danger">
                <td className="py-2 pr-4">✗ {STAGE_LABEL[task] ?? task}</td>
                <td className="py-2 pr-4" colSpan={3}>
                  never answered
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.errors.length > 0 ? (
        <ul className="mt-4 space-y-1 text-step--1 text-text-muted">
          {report.errors.map((e, i) => (
            <li key={`${e.task}-${i}`}>
              <span className="text-text">{STAGE_LABEL[e.task] ?? e.task}</span>
              : {e.message}
            </li>
          ))}
        </ul>
      ) : null}

      {report.verdict === "wasteful" ? (
        <p className="mt-4 max-w-measure text-step--1 text-text-muted">
          A discarded call is billed like any other. The reason above says which
          kind it was: an answer that ran past the ceiling it was given, or one
          the pipeline refused to accept in the shape it arrived in. The first
          is worth a model with more room to write, the second a model that
          follows the format more closely.
        </p>
      ) : null}
    </div>
  );
}
