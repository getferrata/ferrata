"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

interface Preview {
  title: string;
  author: string | null;
  lang: string;
  license: string | null;
  moduleCount: number;
  questionCount: number;
  conceptCount: number;
  exportedAt: number;
}

export default function ImportPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function parsedBody(): unknown {
    return JSON.parse(raw);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRaw(await file.text());
    setFileName(file.name);
    setPreview(null);
    setError(null);
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedBody()),
      });
      const data = (await res.json()) as { preview?: Preview; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setPreview(data.preview ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid JSON or malformed package",
      );
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedBody()),
      });
      const data = (await res.json()) as { courseId?: string; error?: string };
      if (!res.ok || !data.courseId) throw new Error(data.error ?? "Import failed");
      router.push(`/courses/${data.courseId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-measure px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">Import a course</h1>
        <p className="mt-3 text-step-0 text-text-muted">
          Paste or upload a <code className="mono">.ferrata.json</code> package.
          Imported content comes from an external source: it will be shown
          read-only, sanitized, and marked as <em>not verified by you</em>.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="pkg-file"
              type="file"
              aria-label="Upload a .ferrata.json package"
              accept=".json,application/json"
              onChange={onFile}
              className="peer sr-only"
            />
            <label
              htmlFor="pkg-file"
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded border border-border bg-surface px-4 text-step--1 text-text transition hover:border-text-muted peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              Upload a file…
            </label>
            <span className="text-step--1 text-text-muted" aria-live="polite">
              {fileName ?? "or paste below"}
            </span>
          </div>
          <textarea
            value={raw}
            aria-label="Paste the JSON package contents"
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
            }}
            rows={8}
            placeholder='{ "manifest": { "format": "ferrata", … }, … }'
            className="w-full resize-y rounded border border-border bg-surface p-3 font-mono text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={doPreview}
            disabled={busy || raw.trim().length < 2}
            className="min-h-[36px] self-start rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
          >
            Preview
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-step--1 text-danger">
            {error}
          </p>
        ) : null}

        {preview ? (
          <section className="mt-8 rounded border border-state-doubt p-5">
            <p className="text-step--1 uppercase tracking-wide text-state-doubt">
              To confirm · not verified by you
            </p>
            <h2 className="mt-2 font-serif text-step-2">{preview.title}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-step--1 text-text-muted">
              <Row k="Author" v={preview.author ?? "-"} />
              <Row k="Language" v={preview.lang} />
              <Row k="Concepts" v={String(preview.conceptCount)} />
              <Row k="Modules" v={String(preview.moduleCount)} />
              <Row k="Questions" v={String(preview.questionCount)} />
              <Row k="License" v={preview.license ?? "-"} />
            </dl>
            <button
              type="button"
              onClick={doImport}
              disabled={busy}
              className="mt-5 min-h-[40px] rounded bg-accent px-5 text-step-0 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import and study"}
            </button>
          </section>
        ) : null}
      </main>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="text-text">{v}</dd>
    </>
  );
}
