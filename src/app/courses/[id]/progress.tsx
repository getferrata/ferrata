"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RetryBuild } from "@/components/retry-build";
import { useRouter } from "next/navigation";
import { ConceptGraph } from "@/components/concept-graph";
import {
  AUTHORING_STEPS,
  AuthoringSteps,
  stepForStatus,
} from "@/components/authoring-steps";
import { CableProgress } from "@/components/cable-progress";

// Climbing-voice status line for each automated pipeline phase.
const STAGE_COPY: Record<string, string> = {
  interviewing: "Reading the material",
  intake: "Reading the material and context",
  graphing: "Setting the anchors",
  triaging: "Trimming to the time budget",
  generating: "Fixing the cable",
  finishing: "Writing the study plan and the glossary",
};

const CLIMB_STATES = new Set([
  "interviewing",
  "intake",
  "graphing",
  "triaging",
  "generating",
  "finishing",
]);

interface InterviewQuestion {
  key: string;
  question: string;
  why: string;
}
interface Course {
  status: string;
  domain: string | null;
  lang: string;
  interviewJson: string | null;
}
interface Concept {
  id: string;
  title: string;
  summary: string;
}
interface Edge {
  from: string;
  to: string;
}
interface Payload {
  course: Course;
  concepts: Concept[];
  edges?: Edge[];
  lastError?: string | null;
  modulesDone?: number;
  conceptCount?: number;
}

export function PipelineProgress({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const payload = (await res.json()) as Payload;
      if (stopped.current) return;
      setData(payload);
      const s = payload.course.status;
      if (s === "ready") {
        // refresh() re-renders the server component, which swaps this screen for
        // the course. If it is slow or fails, the "ready" state below gives the
        // author a link rather than a finished bar and nothing to click.
        router.refresh();
        return;
      }
      // Pause polling while the author is answering the interview or reviewing
      // the concept list: both are human steps.
      if (s === "interview" || s === "concept_review" || s === "failed") return;
    } catch (err) {
      if (!stopped.current) setError(err instanceof Error ? err.message : "Error");
      return;
    }
    if (!stopped.current) setTimeout(poll, 1500);
  }, [id, router]);

  useEffect(() => {
    stopped.current = false;
    void poll();
    return () => {
      stopped.current = true;
    };
  }, [poll]);

  if (error) {
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  }

  const status = data?.course.status ?? "interviewing";

  if (status === "failed") {
    const raw = data?.lastError ?? "";
    const dailyCap = /per day|TPD|al giorno|tokens per day/i.test(raw);
    const rateLimited =
      dailyCap || /rate.?limit|429|tokens per minute|TPM/i.test(raw);
    // Which provider actually refused, so the advice matches the failure. The
    // generic text used to send everyone to check Ollama, including people
    // whose Anthropic key had just returned a 400.
    const provider = /anthropic/i.test(raw)
      ? "anthropic"
      : /ollama/i.test(raw)
        ? "ollama"
        : /openai|groq/i.test(raw)
          ? "openai"
          : null;
    const badKey = /401|403|invalid.?api.?key|authentication/i.test(raw);
    return (
      <div className="flex flex-col gap-8">
        <AuthoringSteps current={4} failed />
        <div className="max-w-measure">
          <h2 className="font-serif text-step-2">Build failed</h2>
          {dailyCap ? (
            <p className="mt-3 text-text-muted">
              You&rsquo;ve used up the model&rsquo;s{" "}
              <strong>daily token limit</strong> (Groq&rsquo;s free plan gives
              about 100,000 tokens a day on the 70B). It isn&rsquo;t the topic or
              the length: today&rsquo;s budget is spent and it refills in about an
              hour. Ways out: switch to a model with a separate budget (
              <code>OPENAI_MODEL_HEAVY=llama-3.1-8b-instant</code>), enable
              Groq&rsquo;s Dev tier, or try again later. With{" "}
              <code>FERRATA_LITE=1</code> each course uses far fewer tokens.
            </p>
          ) : rateLimited ? (
            <p className="mt-3 text-text-muted">
              You&rsquo;ve hit the <strong>model&rsquo;s rate limit</strong> (e.g.
              Groq&rsquo;s free plan: 12,000 tokens a minute). It isn&rsquo;t the
              topic: the provider refused the calls. Try again. Ferrata now waits
              and retries on its own when a 429 comes back, but on the free plan
              generation is slower. To go faster: a model with higher limits (
              <code>OPENAI_MODEL_HEAVY</code>) or Groq&rsquo;s Dev tier.
            </p>
          ) : badKey ? (
            <p className="mt-3 text-text-muted">
              The provider refused the key. Check it under{" "}
              <a href="/settings" className="text-accent underline underline-offset-2">
                Settings
              </a>{" "}
              with the Test connection button.
            </p>
          ) : provider === "ollama" ? (
            <p className="mt-3 text-text-muted">
              The local model server did not answer. Check that{" "}
              <code>ollama serve</code> is running and the model is pulled, or
              set an API key under{" "}
              <a href="/settings" className="text-accent underline underline-offset-2">
                Settings
              </a>
              .
            </p>
          ) : provider ? (
            <p className="mt-3 text-text-muted">
              The model provider refused the call. The reason it gave is under
              Technical detail below. If it names a setting, change it under{" "}
              <a href="/settings" className="text-accent underline underline-offset-2">
                Settings
              </a>{" "}
              and build again: what is written so far is kept.
            </p>
          ) : (
            <p className="mt-3 text-text-muted">
              A model call failed. The reason is under Technical detail below.
              Check the model configuration under{" "}
              <a href="/settings" className="text-accent underline underline-offset-2">
                Settings
              </a>{" "}
              with the Test connection button.
            </p>
          )}
          <RetryBuild courseId={id} writtenModules={data?.modulesDone ?? 0} />

          {raw ? (
            <details className="mt-4">
              <summary className="cursor-pointer select-none text-step--1 text-text-muted">
                Technical detail
              </summary>
              <pre className="mt-2 overflow-x-auto rounded border border-border bg-bg-subtle p-3 text-step--1">
                {raw.slice(0, 600)}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  if (CLIMB_STATES.has(status)) {
    return <PipelineClimb status={status} data={data} />;
  }

  let body: React.ReactNode;
  if (status === "interview" && data) {
    body = (
      <InterviewForm
        id={id}
        questions={parseInterview(data.course.interviewJson)}
        onDone={() => {
          stopped.current = false;
          void poll();
        }}
      />
    );
  } else if (status === "concept_review" && data) {
    body = (
      <ConceptReview
        id={id}
        concepts={data.concepts}
        onDone={() => {
          stopped.current = false;
          void poll();
        }}
      />
    );
  } else if (status === "ready") {
    // The refresh above normally swaps this whole screen for the course, so
    // this is the fallback for when it has not landed yet. A finished build
    // with nothing to click reads as a build that got stuck.
    body = (
      <div className="max-w-measure">
        <h2 className="font-serif text-step-2">The route is rigged.</h2>
        <p className="mt-3 text-text-muted">
          Every module is written and every test is in place.
        </p>
        <a
          href={`/courses/${id}`}
          className="mt-5 inline-flex min-h-[44px] items-center self-start rounded border border-text px-5 text-text transition hover:bg-bg-subtle"
        >
          Open the course
        </a>
      </div>
    );
  } else {
    body = <Spinner label="Getting things ready…" />;
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthoringSteps current={stepForStatus(status)} />
      {body}
    </div>
  );
}

function PipelineClimb({
  status,
  data,
}: {
  status: string;
  data: Payload | null;
}) {
  const current = stepForStatus(status);
  const generating = status === "generating";
  const total = data?.conceptCount ?? 0;
  const done = data?.modulesDone ?? 0;
  const pct =
    generating && total > 0 ? Math.round((done / total) * 100) : undefined;
  const sub =
    generating && total > 0
      ? `Writing module ${Math.min(done + 1, total)} of ${total}`
      : undefined;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <CableProgress
          steps={AUTHORING_STEPS}
          current={current}
          percent={pct}
        />
        <div className="max-w-xs">
          {pct != null ? (
            <>
              <p className="font-mono text-[3.25rem] font-medium leading-none text-text">
                {pct}
                <span className="ml-1 text-step-1 text-text-muted">%</span>
              </p>
              <p className="mt-1 text-step--1 uppercase tracking-[0.14em] text-text-muted">
                built
              </p>
            </>
          ) : (
            <p className="font-serif text-step-2 leading-tight text-text">
              {STAGE_COPY[status] ?? "Working"}
            </p>
          )}
          {sub ? (
            <p className="mt-2 font-mono text-step--1 text-text-muted">{sub}</p>
          ) : null}
          <p className="mt-5 text-step--1 text-text-muted">
            You can close this page. Generation keeps running, and it will be
            here when you come back.
          </p>
        </div>
      </div>

      {data && data.concepts.length > 0 ? (
        <section>
          <h2 className="text-step--1 uppercase tracking-wide text-text-muted">
            {data.concepts.length} concepts found
          </h2>
          {data.edges && data.edges.length > 0 ? (
            <div className="mt-4 rounded border border-border bg-bg-subtle p-4">
              <ConceptGraph
                nodes={data.concepts.map((c) => ({ id: c.id, title: c.title }))}
                edges={data.edges}
              />
            </div>
          ) : null}
          <ul className="mt-4 flex flex-col gap-2">
            {data.concepts.map((c) => (
              <li
                key={c.id}
                className="rounded border border-border bg-surface px-4 py-3"
              >
                <p className="font-serif text-step-0">{c.title}</p>
                <p className="mt-0.5 text-step--1 text-text-muted">
                  {c.summary}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function parseInterview(json: string | null): InterviewQuestion[] {
  if (!json) return [];
  try {
    const s = JSON.parse(json) as { questions?: InterviewQuestion[] };
    return Array.isArray(s.questions) ? s.questions : [];
  } catch {
    return [];
  }
}

function InterviewForm({
  id,
  questions,
  onDone,
}: {
  id: string;
  questions: InterviewQuestion[];
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const answered = Object.values(answers).filter((v) => v.trim()).length;

  async function submit(withAnswers: boolean) {
    setSubmitting(true);
    try {
      await fetch(`/api/courses/${id}/interview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: withAnswers ? answers : {} }),
      });
      onDone();
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-measure">
      <h2 className="font-serif text-step-2 leading-tight">A few questions</h2>
      <p className="mt-2 text-step-0 text-text-muted">
        The course is only as good as the context you give it. Answer what you
        know. Every answer shifts the priorities, the cuts, and the tone. You can
        skip questions that don&rsquo;t apply to you. After this you review the
        plan, then I build.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {questions.map((q) => (
          <div key={q.key}>
            <label
              htmlFor={`iv-${q.key}`}
              className="block font-serif text-step-1 text-text"
            >
              {q.question}
            </label>
            <p className="mt-0.5 text-step--1 text-text-muted">→ {q.why}</p>
            <textarea
              id={`iv-${q.key}`}
              value={answers[q.key] ?? ""}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, [q.key]: e.target.value }))
              }
              rows={2}
              className="mt-2 w-full resize-y rounded border border-border bg-surface p-3 font-serif text-step-0 text-text focus:border-text-muted focus-visible:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={submitting}
          className="min-h-[44px] rounded bg-accent px-6 text-step-0 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-60"
        >
          {submitting
            ? "Moving on…"
            : answered > 0
              ? `Continue with ${answered} answer${answered === 1 ? "" : "s"}`
              : "Continue"}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={submitting}
          className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
        >
          Skip all and continue with less context
        </button>
      </div>
    </div>
  );
}

interface SetupCost {
  configured: boolean;
  active: { provider: string; model: string };
  cost: { baseUsd: number; perModuleUsd: number; measured?: boolean };
}

function buildCostLine(setup: SetupCost, modules: number): string {
  const usd = setup.cost.baseUsd + setup.cost.perModuleUsd * modules;
  if (usd <= 0) return `Estimated cost: free (local model)`;
  const s = usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
  // Say where the figure comes from. A number measured on this install is
  // worth more than one from a table, and a reader deserves to know which.
  return setup.cost.measured
    ? `Estimated cost: ~${s} once, on your key at cost · from what your own courses have cost so far`
    : `Estimated cost: ~${s} once, on your key at cost · a rough figure until this install has built a few courses`;
}

function ConceptReview({
  id,
  concepts,
  onDone,
}: {
  id: string;
  concepts: Concept[];
  onDone: () => void;
}) {
  const [kept, setKept] = useState<Set<string>>(
    () => new Set(concepts.map((c) => c.id)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [setup, setSetup] = useState<SetupCost | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/setup", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SetupCost | null) => {
        if (alive && d) setSetup(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function toggle(cid: string) {
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }

  async function generate() {
    setSubmitting(true);
    const dropIds = concepts.map((c) => c.id).filter((cid) => !kept.has(cid));
    try {
      const res = await fetch(`/api/courses/${id}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropIds }),
      });
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-measure">
      <h2 className="font-serif text-step-2 leading-tight">
        Review the plan before building
      </h2>
      <p className="mt-2 text-step-0 text-text-muted">
        These are the concepts we found. Remove the ones you don&rsquo;t need: I
        will build (and you will pay for) only the modules you keep. You&rsquo;re
        keeping{" "}
        <strong className="text-text">{kept.size}</strong> of {concepts.length}.
      </p>

      <ul className="mt-6 flex flex-col gap-2">
        {concepts.map((c) => {
          const on = kept.has(c.id);
          return (
            <li key={c.id}>
              <label
                className={
                  "flex cursor-pointer items-start gap-3 rounded border p-3 transition " +
                  (on
                    ? "border-border bg-surface"
                    : "border-border bg-bg-subtle opacity-50")
                }
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(c.id)}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-serif text-step-0 text-text">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block text-step--1 text-text-muted">
                    {c.summary}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={generate}
          disabled={submitting || kept.size === 0}
          className="min-h-[44px] rounded bg-accent px-6 text-step-0 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Building…" : `Build the modules (${kept.size})`}
        </button>
        {kept.size === 0 ? (
          <span className="text-step--1 text-danger">
            Keep at least one concept.
          </span>
        ) : null}
      </div>
      {setup?.configured && kept.size > 0 ? (
        <p className="mt-2 text-step--1 text-text-muted">
          {buildCostLine(setup, kept.size)} · {setup.active.model}
        </p>
      ) : null}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-text-muted">
      <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-accent" />
      <p className="font-serif text-step-1">{label}</p>
    </div>
  );
}
