"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Same cadence and ceiling as the proposals panel: a light server re-render
// every 2.5s, capped so a wedged rewrite cannot refresh forever.
const POLL_MS = 2500;
const MAX_POLLS = 120;

/**
 * A live banner while this module is being rewritten. The page is a server
 * snapshot, so on its own it would show the old body until the author reloaded
 * and guessed when the swap had happened. This polls until the rewrite lands
 * (the in-flight job clears) and the new body appears in place, because the
 * module id is kept across the swap.
 */
export function ModuleRewriting({ rewriting }: { rewriting: boolean }) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!rewriting) return;
    setStalled(false);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > MAX_POLLS) {
        clearInterval(t);
        setStalled(true);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [rewriting, router]);

  if (!rewriting && !stalled) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded border border-accent bg-bg-subtle px-4 py-3 text-step--1 text-text"
    >
      {stalled
        ? "Still rewriting, or the rewrite stalled. Reload the page to check."
        : "Rewriting this module and its tests from your material. It updates here on its own, in a minute or two. You can leave and come back."}
    </div>
  );
}
