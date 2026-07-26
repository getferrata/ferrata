"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FerrataMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthoringSteps } from "@/components/authoring-steps";

const EXAMPLE = `I'm a systems engineer with firewall and Linux experience. I have an interview Thursday at 10:30 for a Network & Security Engineer role in a data center. They want BGP full table, OSPF, AS and RIPE management, NSX, SD-WAN and Azure networking. I have eight hours. I've never run BGP.`;

type Depth = "overview" | "operational" | "scratch";

interface SetupInfo {
  configured: boolean;
  reason: string | null;
  active: { provider: string; model: string };
  cost: { baseUsd: number; perModuleUsd: number; measured?: boolean };
}

/** Course cost for a typical build, shown before committing. */
function costLine(setup: SetupInfo, modules = 8): string {
  const usd = setup.cost.baseUsd + setup.cost.perModuleUsd * modules;
  if (usd <= 0) return "free · local model";
  const s = usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
  return `~${s} once · your key, at cost`;
}
type Contextia = "redact" | "block" | "off";

const TEMPLATES: { label: string; depth: Depth; text: string }[] = [
  {
    label: "Developer onboarding",
    depth: "scratch",
    text: "Bring a new developer up to speed on our service in two weeks: the architecture, the deploy flow, and the critical parts of the code. They're a senior generalist but don't know our domain. (Attach the repo path and runbooks below.)",
  },
  {
    label: "Sysadmin onboarding",
    depth: "operational",
    text: "Onboard a sysadmin on our infrastructure: network, firewalls, recovery procedures, operational runbooks. They must be able to handle on-call within a month. (Attach runbooks and docs; addresses and server names stay protected by Contextia.)",
  },
  { label: "Interview prep (example)", depth: "operational", text: EXAMPLE },
];

const DEPTHS: { key: Depth; label: string; hint: string }[] = [
  { key: "overview", label: "Overview", hint: "assumes the basics, fewer modules" },
  { key: "operational", label: "Operational", hint: "concrete, ready to use on the job" },
  { key: "scratch", label: "From scratch", hint: "explains the prerequisites too" },
];

const MODES: { key: Contextia; label: string; hint: string }[] = [
  { key: "redact", label: "Protected", hint: "Recommended. Secrets (keys, tokens, PII) are removed before any model sees them. Internal IPs and server names are hidden from the model and restored into the finished course, marked as protected." },
  { key: "block", label: "Block secrets", hint: "Like Protected, but a source containing critical secrets is refused. You clean it and re-upload." },
  { key: "off", label: "Off", hint: "No scan: text passes through untouched. Only for material you've already cleaned. Secrets can reach the model." },
];

export default function CreatePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [hours, setHours] = useState("");
  const [level, setLevel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState("");
  const [crawlSubpages, setCrawlSubpages] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [depth, setDepth] = useState<Depth>("operational");
  const [contextia, setContextia] = useState<Contextia>("redact");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/setup", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SetupInfo | null) => {
        if (alive && d) setSetup(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasMaterial =
      files.length > 0 || /https?:\/\//i.test(urls) || repoPath.trim() !== "";
    if (prompt.trim().length < 10 && !hasMaterial) {
      setError(
        "Write a brief or attach at least one piece of material. Either works.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("prompt", prompt.trim());
      if (hours.trim()) fd.append("hours", hours.trim());
      if (level.trim()) fd.append("level", level.trim());
      if (urls.trim()) fd.append("urls", urls.trim());
      if (crawlSubpages) fd.append("crawl", "1");
      if (repoPath.trim()) fd.append("repoPath", repoPath.trim());
      fd.append("depth", depth);
      fd.append("contextia", contextia);
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/courses", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as { id: string };
      router.push(`/courses/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSubmitting(false);
    }
  }

  const depthLabel = DEPTHS.find((d) => d.key === depth)?.label ?? "";
  const modeLabel = MODES.find((m) => m.key === contextia)?.label ?? "";
  const urlCount = urls
    .split(/[\n,]+/)
    .filter((s) => /^https?:\/\//i.test(s.trim())).length;
  const materialSummary =
    files.length === 0 && urlCount === 0 && !repoPath.trim()
      ? "none yet"
      : [
          files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : null,
          urlCount ? `${urlCount} link${urlCount === 1 ? "" : "s"}` : null,
          repoPath.trim() ? "repo" : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link
          href="/courses"
          aria-label="Ferrata: my courses"
          className="inline-flex items-center gap-2 text-text-muted transition hover:text-text"
        >
          <FerrataMark className="h-7 w-7 text-text" />
          <span className="text-step--1">← My courses</span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="mt-8">
        <AuthoringSteps current={1} />
      </div>

      {setup && !setup.configured ? (
        <div className="mt-8 rounded-lg border border-state-doubt bg-bg-subtle p-4">
          <p className="font-serif text-step-0 text-text">
            One thing before your first course: connect a model.
          </p>
          <p className="mt-1 max-w-measure text-step--1 text-text-muted">
            Ferrata needs an AI provider to generate. Paste an API key, or point
            it at a local model. Two minutes, one time.
          </p>
          <Link
            href="/settings"
            className="mt-2 inline-block text-step--1 text-accent underline underline-offset-2"
          >
            Set up the model →
          </Link>
        </div>
      ) : null}

      <header className="mb-8 mt-8">
        <h1 className="font-serif text-step-4 leading-[1.05] tracking-tight">
          Rig a path
        </h1>
        <p className="mt-3 max-w-measure font-serif text-step-1 text-text-muted">
          Start from whatever you have: a written brief, files, links, a repo.
          One is enough, and you can mix them freely. Then I ask a few
          questions, we review the plan together, and I build a verified path
          that fits the time you have.
        </p>
      </header>

      <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_19rem]">
        {/* ---- left column: the inputs ---- */}
        <div className="flex flex-col gap-9">
          {/* 01 · the brief */}
          <section>
            <SectionHead
              n="01"
              title="The brief"
              tag="skip it if you attach material"
            />
            <label htmlFor="prompt" className="sr-only">
              What they need to learn
            </label>
            <textarea
              id="prompt"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="e.g. Onboard a new on-call engineer on our edge gateway and how incidents actually play out. Two weeks."
              className="w-full resize-y rounded-lg border border-border bg-surface p-4 font-serif text-step-0 leading-relaxed text-text shadow-sm placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
            />
            <div className="mt-3">
              <span className="text-step--1 text-text-muted">Start from a template:</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => {
                      setPrompt(t.text);
                      setDepth(t.depth);
                    }}
                    className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-step--1 text-text transition hover:border-accent hover:shadow-sm"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 02 · material */}
          <section>
            <SectionHead
              n="02"
              title="Ground it on your material"
              tag="mix freely, or skip if you wrote a brief"
            />
            <p id="files-desc" className="text-step--1 text-text-muted">
              Doc, PDF, .md, .txt. The course is anchored to this and cites its
              sources. Nothing here is required, but the more context, the sharper
              the path.
            </p>

            <input
              id="files"
              type="file"
              multiple
              accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.yaml,.yml,.log"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              aria-describedby="files-desc"
              className="peer sr-only"
            />
            <label
              htmlFor="files"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files?.length) {
                  setFiles(Array.from(e.dataTransfer.files));
                }
              }}
              className={
                "mt-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-7 text-center transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent " +
                (dragging
                  ? "border-accent bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]"
                  : "border-border bg-bg-subtle hover:border-text-muted")
              }
            >
              <span className="font-serif text-step-0 text-text">
                Drag files here, or <span className="text-accent underline underline-offset-2">choose</span>
              </span>
              <span className="text-step--1 text-text-muted" aria-live="polite">
                {files.length === 0
                  ? "no files chosen"
                  : `${files.length} file${files.length === 1 ? "" : "s"} ready`}
              </span>
            </label>

            {files.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-step--1"
                  >
                    <span className="min-w-0 truncate text-text">{f.name}</span>
                    <span className="shrink-0 font-mono text-text-muted">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4">
              <label htmlFor="urls" className="text-step--1 text-text-muted">
                Or paste links: a wiki page, a doc site (one per line). We fetch
                and extract each. For sites behind sign-in, add a token under{" "}
                <Link
                  href="/settings#connections"
                  className="text-accent underline underline-offset-2"
                >
                  Site connections
                </Link>
                . A link that fails shows in red with the reason.
              </label>
              <textarea
                id="urls"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                rows={2}
                placeholder="https://wiki.acme.com/onboarding/edge-gateway"
                className="mt-2 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
              />
              {/* The whole row is the target: a 16px box is unusable on a phone. */}
              <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-3 py-1 text-step--1 text-text-muted">
                <input
                  type="checkbox"
                  checked={crawlSubpages}
                  onChange={(e) => setCrawlSubpages(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                Include subpages (same site, up to 30 pages, respects robots.txt)
              </label>
            </div>

            <div className="mt-4">
              <label htmlFor="repoPath" className="text-step--1 text-text-muted">
                Or a local repo (onboard on your own code): the absolute path of a
                folder already on the machine. The operator has to allow the folder
                first, with <code className="font-mono">FERRATA_REPO_ROOTS</code>.
                Files pass through Contextia; modules cite{" "}
                <code className="font-mono">[source: src/…]</code>.
              </label>
              <input
                id="repoPath"
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/home/user/code/our-service"
                className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
              />
            </div>
          </section>

          {/* 03 · depth */}
          <section>
            <SectionHead n="03" title="How deep" />
            <div className="grid gap-2 sm:grid-cols-3">
              {DEPTHS.map((d) => {
                const on = depth === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setDepth(d.key)}
                    aria-pressed={on}
                    className={
                      "rounded-lg border px-4 py-3 text-left transition " +
                      (on
                        ? "border-accent bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] shadow-sm"
                        : "border-border hover:border-text-muted")
                    }
                  >
                    <span
                      className={
                        "block text-step-0 " + (on ? "text-accent" : "text-text")
                      }
                    >
                      {d.label}
                    </span>
                    <span className="mt-0.5 block text-step--1 text-text-muted">
                      {d.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-step--1 text-text-muted">
              Deeper = more &ldquo;exploded&rdquo; explanations (explaining BGP also
              tells you what an IP is) and more modules.
            </p>
          </section>

          {/* 04 · contextia */}
          <section>
            <SectionHead n="04" title="Data protection" tag="Contextia" />
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => {
                const on = contextia === m.key;
                const green = m.key !== "off";
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setContextia(m.key)}
                    aria-pressed={on}
                    className={
                      "flex items-center gap-2 rounded-lg border px-4 py-3 text-left transition " +
                      (on
                        ? green
                          ? "border-[color:var(--state-solid)] bg-[color-mix(in_srgb,var(--state-solid)_9%,transparent)] shadow-sm"
                          : "border-accent bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] shadow-sm"
                        : "border-border hover:border-text-muted")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "h-2.5 w-2.5 shrink-0 rounded-full " +
                        (green
                          ? "bg-[color:var(--state-solid)]"
                          : "border-2 border-text-muted")
                      }
                    />
                    <span
                      className={
                        "text-step-0 " +
                        (on ? (green ? "text-[color:var(--state-solid)]" : "text-accent") : "text-text")
                      }
                    >
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 max-w-measure text-step--1 text-text-muted">
              {MODES.find((m) => m.key === contextia)?.hint}
            </p>
          </section>

          {/* advanced */}
          <details className="rounded-lg border border-border bg-bg-subtle px-4 py-3">
            <summary className="cursor-pointer select-none text-step--1 text-text-muted">
              Scope and starting level (optional)
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Scope (study hours)">
                <input
                  type="number"
                  min={1}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="8"
                  className={inputClass}
                />
              </Field>
              <Field label="Starting level">
                <input
                  type="text"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  placeholder="never ran BGP"
                  className={inputClass}
                />
              </Field>
            </div>
            <p className="mt-2 text-step--1 text-text-muted">
              Scope decides how much the course trims. The deadline isn&rsquo;t here:
              you set it per student when you assign it (so late joiners get their
              own).
            </p>
          </details>
        </div>

        {/* ---- right column: the live route card ---- */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="relative rounded-lg border border-border bg-surface p-5 shadow-sm">
            <span className="absolute -top-2.5 left-4 bg-surface px-1.5 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-text-muted">
              Route card
            </span>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
              <RCRow label="Topic">
                {prompt.trim() ? (
                  <span className="line-clamp-2 text-text">{prompt.trim()}</span>
                ) : materialSummary !== "none yet" ? (
                  <span className="text-text-muted">from the material</span>
                ) : (
                  <span className="text-text-muted">-</span>
                )}
              </RCRow>
              <RCRow label="Material">{materialSummary}</RCRow>
              <RCRow label="Depth">{depthLabel}</RCRow>
              <RCRow label="Protection">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={
                      "h-2 w-2 rounded-full " +
                      (contextia === "off"
                        ? "border border-text-muted"
                        : "bg-[color:var(--state-solid)]")
                    }
                  />
                  {modeLabel}
                </span>
              </RCRow>
              <RCRow label="Scope">
                {hours.trim() ? `${hours}h` : "per student"}
              </RCRow>
              {setup?.configured ? (
                <RCRow label="Cost">{costLine(setup)}</RCRow>
              ) : null}
            </dl>

            <hr className="my-4 border-t border-dashed border-border" />

            {error ? (
              <p role="alert" className="mb-3 text-step--1 text-danger">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[46px] w-full items-center justify-center rounded-lg bg-accent px-6 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Building…" : "Rig the path →"}
            </button>
            <p className="mt-2 text-center text-step--1 text-text-muted">
              First a few questions to pull out your context.
            </p>
          </div>
        </aside>
      </form>

      <p className="mt-10 flex flex-wrap gap-x-6 gap-y-1 text-step--1 text-text-muted">
        <Link href="/courses" className="text-accent underline underline-offset-2">
          My courses
        </Link>
        <span>
          Already have a package?{" "}
          <Link href="/import" className="text-accent underline underline-offset-2">
            Import one
          </Link>
        </span>
      </p>
    </main>
  );
}

function SectionHead({
  n,
  title,
  tag,
  optional,
}: {
  n: string;
  title: string;
  tag?: string;
  optional?: boolean;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <span className="font-mono text-step--1 text-accent">{n}</span>
      <h2 className="font-serif text-step-1 text-text">{title}</h2>
      {tag ? (
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-text-muted">
          {tag}
        </span>
      ) : null}
      {optional ? (
        <span className="text-step--1 text-text-muted">· optional</span>
      ) : null}
    </div>
  );
}

function RCRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-text-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-step--1 text-text">{children}</dd>
    </>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-step--1 text-text-muted">{label}</span>
      {children}
    </label>
  );
}
