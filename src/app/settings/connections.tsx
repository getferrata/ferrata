"use client";

import { useCallback, useEffect, useState } from "react";

interface Connection {
  id: string;
  host: string;
  kind: "basic" | "bearer";
  username: string | null;
  secret: string | null;
}

/**
 * Credentials for linked knowledge sources behind sign-in: store a token for
 * a host once, and every pasted link on that host uses it automatically.
 */
export function ConnectionsPanel() {
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [host, setHost] = useState("");
  const [kind, setKind] = useState<"basic" | "bearer">("bearer");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/connections", { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as { connections: Connection[] };
      setRows(data.connections);
    } catch {
      setError("Could not load connections.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host,
          kind,
          username: kind === "basic" ? username : undefined,
          secret,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "could not save");
      }
      setHost("");
      setUsername("");
      setSecret("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/settings/connections?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
    await load();
  }

  return (
    <section id="connections" className="mt-14 border-t border-border pt-10">
      <h2 className="font-serif text-step-2 leading-tight">Site connections</h2>
      <p className="mt-2 max-w-measure text-step-0 text-text-muted">
        For linked material that sits behind sign-in (a company wiki, an
        internal doc site). Store a token for the site once; every link you
        paste from it is fetched with that credential. Secrets stay in your
        local database and are only ever sent to that site.
      </p>

      {rows && rows.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface px-4 py-3 text-step--1"
            >
              <span className="font-mono text-text">{c.host}</span>
              <span className="text-text-muted">
                {c.kind === "basic"
                  ? `user + token${c.username ? ` (${c.username})` : ""}`
                  : "bearer token"}
              </span>
              <span className="font-mono text-text-muted">{c.secret}</span>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                className="ml-auto rounded border border-border px-2.5 py-1 text-text-muted transition hover:border-danger hover:text-danger"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : rows ? (
        <p className="mt-6 text-step--1 text-text-muted">
          No site connections yet.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-bg-subtle p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-step--1 text-text-muted">
              Site (host or URL)
            </span>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="wiki.yourcompany.com"
              spellCheck={false}
              className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-step--1 text-text-muted">Auth type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "basic" | "bearer")}
              className="mt-1 w-full rounded border border-border bg-surface p-3 text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
            >
              <option value="bearer">Bearer token</option>
              <option value="basic">Username + token (e.g. Confluence)</option>
            </select>
          </label>
          {kind === "basic" ? (
            <label className="block">
              <span className="text-step--1 text-text-muted">
                Username or account email
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="text-step--1 text-text-muted">Token</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-step--1 text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !host.trim() || !secret.trim()}
            className="min-h-[40px] rounded bg-accent px-5 text-step--1 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add connection"}
          </button>
        </div>
      </div>
    </section>
  );
}
