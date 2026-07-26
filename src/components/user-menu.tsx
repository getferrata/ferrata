"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Me {
  id: string;
  name: string;
  role: "student" | "examiner";
}

/**
 * Header account chip: shows who's logged in (and, for examiners, a link to the
 * roster) plus logout. Fetches client-side so SiteHeader can stay a plain
 * component usable from both server and client pages.
 */
export function UserMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { user: Me | null }) => {
        if (live) setMe(d.user);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  if (!me) return null;

  return (
    <div className="flex items-center gap-3 text-step--1">
      <span className="hidden text-text-muted sm:inline">{me.name}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded border border-border px-2.5 py-1 text-text-muted transition hover:text-text"
      >
        Sign out
      </button>
    </div>
  );
}
