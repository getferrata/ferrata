"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

/**
 * Route error boundary. Keeps the failure on-brand and offers a way out instead
 * of a white screen. `reset` retries the segment; the links are the escape.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link href="/" aria-label="Ferrata, home">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto max-w-measure px-6 py-24">
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          Something broke
        </p>
        <h1 className="mt-3 font-serif text-step-3 leading-tight">
          The cable gave out here
        </h1>
        <p className="mt-4 max-w-measure text-step-0 text-text-muted">
          An unexpected error stopped this page. You can retry, or head back and
          pick up the path.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-step-0">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[40px] items-center rounded bg-accent px-5 font-medium text-accent-contrast transition hover:opacity-90"
          >
            Retry
          </button>
          <Link href="/courses" className="text-accent underline underline-offset-2">
            My courses
          </Link>
          <Link href="/" className="text-accent underline underline-offset-2">
            Home
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-8 text-step--1 text-text-muted">
            Error reference: <code className="mono">{error.digest}</code>
          </p>
        ) : null}
      </main>
    </>
  );
}
