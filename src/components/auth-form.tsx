"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FerrataMark } from "@/components/brand";

type Mode = "login" | "register";

const inputClass =
  "w-full rounded border border-border bg-surface px-3 py-2.5 text-step-0 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none";

export function AuthForm({
  mode,
  invite,
  firstRun = false,
  canRegister = false,
}: {
  mode: Mode;
  invite?: string;
  /** True when no account exists yet, so this one becomes the examiner. */
  firstRun?: boolean;
  /** True when someone arriving at /register could actually get an account. */
  canRegister?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const base =
        mode === "login" ? { email, password } : { email, name, password };
      const body = invite ? { ...base, invite } : base;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        role?: string;
        courseId?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      // Invited → straight into the course; otherwise the role's home.
      if (data.courseId) router.push(`/courses/${data.courseId}`);
      else router.push(data.role === "examiner" ? "/examiner" : "/courses");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-measure flex-col justify-center px-6 py-16">
      <FerrataMark className="mb-6 h-12 w-12 text-text" />
      <h1 className="font-serif text-step-3 leading-tight">
        {mode === "login" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-2 text-step-0 text-text-muted">
        {mode === "login"
          ? "Pick up your paths where you left off."
          : firstRun
            ? "The first account on this install becomes the examiner who sets it up."
            : "Your role comes with the invite, so there is nothing to choose here."}
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-step--1 text-text-muted">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>

        {mode === "register" ? (
          <label className="flex flex-col gap-1">
            <span className="text-step--1 text-text-muted">Name</span>
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-step--1 text-text-muted">Password</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {mode === "register" ? (
            <span className="text-step--1 text-text-muted">
              At least 8 characters.
            </span>
          ) : null}
        </label>

        {error ? (
          <p role="alert" className="text-step--1 text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded bg-accent px-6 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-step--1 text-text-muted">
        {mode === "login" ? (
          // Only offer to create one when creating one will actually work:
          // pointing at a wall that says "invite only" is worse than silence.
          canRegister ? (
            <>
              No account yet?{" "}
              <Link href="/register" className="text-accent underline underline-offset-2">
                Create one
              </Link>
            </>
          ) : (
            <>Accounts here come from an invite link. Ask whoever runs this install for one.</>
          )
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent underline underline-offset-2">
              Sign in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
