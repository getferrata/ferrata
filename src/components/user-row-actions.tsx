"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "student" | "examiner";

/** Per-row actions in user management: toggle role, reset password, remove. */
export function UserRowActions({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: Role;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function setRole(next: Role) {
    setBusy(true);
    await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  async function resetPw() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/password`, { method: "POST" });
      const data = (await res.json()) as { temporaryPassword?: string };
      if (data.temporaryPassword) setTemp(data.temporaryPassword);
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/users/${userId}`, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  if (isSelf) {
    return <span className="text-step--1 text-text-muted">you</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-step--1">
      <button
        type="button"
        disabled={busy}
        onClick={() => setRole(role === "examiner" ? "student" : "examiner")}
        className="tap text-text-muted underline underline-offset-2 hover:text-text disabled:opacity-50"
      >
        {role === "examiner" ? "Make student" : "Make examiner"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={resetPw}
        className="tap text-text-muted underline underline-offset-2 hover:text-text disabled:opacity-50"
      >
        Reset password
      </button>
      {confirmDel ? (
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="tap text-danger hover:underline disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel(false)}
            className="tap text-text-muted hover:text-text"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDel(true)}
          className="tap text-text-muted underline underline-offset-2 hover:text-danger"
        >
          Remove
        </button>
      )}
      {temp ? (
        <span className="w-full text-state-solid">
          Temporary password: <code className="mono">{temp}</code>. Share it with
          the user; you only see it now.
        </span>
      ) : null}
    </div>
  );
}
