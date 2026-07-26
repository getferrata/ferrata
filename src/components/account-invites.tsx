"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PendingInviteView {
  token: string;
  role: "student" | "examiner";
  courseTitle: string | null;
  expiresAt: number;
}

/**
 * Minting and revoking the links that let someone in. This is the only way an
 * account becomes an author, so the choice of role lives here, with the person
 * who runs the install, rather than on the public sign-up form.
 */
export function AccountInvites({ pending }: { pending: PendingInviteView[] }) {
  const router = useRouter();
  const [role, setRole] = useState<"student" | "examiner">("student");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !data.path) throw new Error(data.error ?? "Failed");
      setLink(`${window.location.origin}${data.path}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
    setBusy(false);
  }

  async function revoke(token: string) {
    await fetch(`/api/invites?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    }).catch(() => {});
    router.refresh();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is on screen to select by hand */
    }
  }

  return (
    <section className="mt-12">
      <h2 className="font-serif text-step-2">Invite someone</h2>
      <p className="mt-2 max-w-measure text-step-0 text-text-muted">
        This install is invite only. A link works once, for one person, and
        stops working after three days. The role is set here, not by whoever
        signs up.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Role for this invite</legend>
          {(
            [
              { key: "student", label: "Student" },
              { key: "examiner", label: "Author (can build courses)" },
            ] as const
          ).map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRole(r.key)}
              aria-pressed={role === r.key}
              className={
                "min-h-[40px] rounded border px-4 text-step--1 transition " +
                (role === r.key
                  ? "border-accent bg-accent text-accent-contrast"
                  : "border-border text-text-muted hover:text-text")
              }
            >
              {r.label}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={mint}
          disabled={busy}
          className="min-h-[40px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
        >
          {busy ? "…" : "Create invite link"}
        </button>
      </div>

      {role === "examiner" ? (
        <p className="mt-2 max-w-measure text-step--1 text-text-muted">
          An author can build courses, which spends on this install&rsquo;s API
          key. Only invite people you mean to give that to.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-step--1 text-danger">
          {error}
        </p>
      ) : null}

      {link ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
      ) : null}

      <h3 className="mt-8 text-step-0 text-text">Open invites</h3>
      {pending.length === 0 ? (
        <p className="mt-2 text-step--1 text-text-muted">
          None outstanding.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {pending.map((p) => (
            <li
              key={p.token}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-border px-3 py-2 text-step--1"
            >
              <span className="text-text">
                {p.role === "examiner" ? "Author" : "Student"}
                {p.courseTitle ? ` · ${p.courseTitle}` : ""}
                <span className="ml-2 text-text-muted">
                  expires {new Date(p.expiresAt).toLocaleString()}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(p.token)}
                className="tap text-text-muted underline underline-offset-2 hover:text-danger"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
