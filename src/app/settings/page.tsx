import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { SiteHeader } from "@/components/site-header";
import { LlmSettingsForm } from "./llm-form";
import { ConnectionsPanel } from "./connections";
import { CreditLimitForm } from "@/components/credit-limit-form";
import { creditLimit, creditWindowMs } from "@/lib/llm/credits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (user.role !== "examiner") notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          Settings
        </p>
        <h1 className="mt-2 font-serif text-step-3 leading-tight">
          Model &amp; key
        </h1>
        <p className="mt-3 max-w-measure text-step-0 text-text-muted">
          Ferrata generates with the AI provider you choose, under your own key.
          The key is stored in your local database, never sent anywhere except
          to the provider itself.
        </p>
        <LlmSettingsForm />
        <CreditLimitForm
          initialLimit={creditLimit()}
          initialWindowDays={Math.round(creditWindowMs() / (24 * 60 * 60 * 1000))}
        />
        <ConnectionsPanel />
      </main>
    </>
  );
}
