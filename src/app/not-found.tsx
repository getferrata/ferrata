import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-measure px-6 py-24">
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          404
        </p>
        <h1 className="mt-3 font-serif text-step-3 leading-tight">
          Off the route
        </h1>
        <p className="mt-4 max-w-measure text-step-0 text-text-muted">
          This page doesn&rsquo;t exist, or the course was removed. Clip back onto
          the cable and start from there.
        </p>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-step-0">
          <Link href="/crea" className="text-accent underline underline-offset-2">
            New path
          </Link>
          <Link
            href="/courses"
            className="text-accent underline underline-offset-2"
          >
            My courses
          </Link>
        </div>
      </main>
    </>
  );
}
