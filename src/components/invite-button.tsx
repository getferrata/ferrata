"use client";

import { useState } from "react";

/** Mints a shareable invite link for a course and lets the examiner copy it. */
export function InviteButton({ courseId }: { courseId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/invite`, {
        method: "POST",
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !data.path) throw new Error(data.error ?? "Error");
      setLink(`${window.location.origin}${data.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is visible to select manually */
    }
  }

  if (link) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invite link"
          className="min-w-0 flex-1 rounded border border-border bg-bg-subtle px-3 py-2 font-mono text-step--1 text-text"
        />
        <button
          type="button"
          onClick={copy}
          className="min-h-[38px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={mint}
        disabled={busy}
        className="tap text-step--1 text-accent underline underline-offset-2 disabled:opacity-50"
      >
        {busy ? "…" : "Create an invite link"}
      </button>
      {error ? (
        <span className="ml-3 text-step--1 text-danger">{error}</span>
      ) : null}
    </div>
  );
}
