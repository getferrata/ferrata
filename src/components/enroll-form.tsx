"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Adds someone who already has an account. People who do not have one yet come
 * in through the invite link below, which enrolls them in this course when they
 * sign up.
 */
export function EnrollForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(deadline ? { email, deadline } : { email }),
      });
      const data = (await res.json()) as {
        error?: string;
        student?: { name: string };
      };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setMsg({ kind: "ok", text: `${data.student?.name ?? email} added.` });
      setEmail("");
      router.refresh();
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
      <label htmlFor={`enroll-${courseId}`} className="sr-only">
        Student email
      </label>
      <input
        id={`enroll-${courseId}`}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="student email"
        className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
      />
      <label htmlFor={`deadline-${courseId}`} className="sr-only">
        Deadline for the student (optional)
      </label>
      <input
        id={`deadline-${courseId}`}
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        title="Deadline for this student (optional)"
        className="rounded border border-border bg-surface px-3 py-2 text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={busy}
        className="min-h-[38px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
      >
        {busy ? "…" : "Assign"}
      </button>
      {msg ? (
        <span
          className={
            "w-full text-step--1 " +
            (msg.kind === "ok" ? "text-state-solid" : "text-danger")
          }
          role={msg.kind === "err" ? "alert" : undefined}
        >
          {msg.text}
        </span>
      ) : null}
    </form>
  );
}
