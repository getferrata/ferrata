"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Me {
  role: "student" | "examiner";
}

const EXAMINER_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/crea", label: "New route" },
  { href: "/import", label: "Import" },
  { href: "/examiner", label: "Students" },
  { href: "/examiner/users", label: "Users" },
  { href: "/settings", label: "Settings" },
];

const STUDENT_LINKS = [{ href: "/courses", label: "Courses" }];

/**
 * Primary navigation, role-aware. Examiners get the full management menu up
 * top instead of links buried in page bodies.
 */
export function AppNav() {
  const pathname = usePathname();
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

  const links = !me
    ? []
    : me.role === "examiner"
      ? EXAMINER_LINKS
      : STUDENT_LINKS;

  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {links.map((l) => {
        const active =
          l.href === "/courses" || l.href === "/examiner"
            ? pathname === l.href
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={
              // Roomy enough to hit with a thumb; the extra height collapses
              // back into the header row on wider screens.
              "flex min-h-[40px] items-center text-step--1 transition sm:min-h-0 " +
              (active
                ? "font-medium text-text underline underline-offset-4"
                : "text-text-muted hover:text-text")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
