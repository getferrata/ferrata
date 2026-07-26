import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

export const metadata: Metadata = { title: "Maintenance" };

/**
 * Standalone maintenance page. Kept free of database and session access so it
 * still renders when the rest of the app is down for an update.
 */
export default function Maintenance() {
  return (
    <main className="mx-auto max-w-measure px-6 py-24">
      <Wordmark />
      <p className="mt-14 text-step--1 uppercase tracking-[0.08em] text-text-muted">
        Maintenance
      </p>
      <h1 className="mt-3 font-serif text-step-3 leading-tight">
        We&rsquo;ll be right back
      </h1>
      <p className="mt-4 max-w-measure text-step-0 text-text-muted">
        We&rsquo;re rappelling down for a quick update. Your data is safe and
        nothing was lost. Back on the wall in a few minutes.
      </p>
      <div className="mt-8 text-step-0">
        <Link href="/" className="text-accent underline underline-offset-2">
          Retry now
        </Link>
      </div>
    </main>
  );
}
