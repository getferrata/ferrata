import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { FerrataMark } from "@/components/brand";
import { getCurrentUser, isFirstUser } from "@/lib/auth/session";
import { checkRegistration } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (await getCurrentUser()) redirect(invite ? `/invito/${invite}` : "/courses");

  // Refuse here rather than after they have typed a password into a form that
  // was always going to be turned down.
  const verdict = checkRegistration(invite);
  if (!verdict.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-measure flex-col justify-center px-6 py-16">
        <FerrataMark className="mb-6 h-12 w-12 text-text" />
        <h1 className="font-serif text-step-3 leading-tight">Invite only</h1>
        <p className="mt-3 max-w-measure text-step-0 text-text-muted">
          {verdict.error}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-step-0 text-accent underline underline-offset-2"
        >
          I already have an account
        </Link>
      </main>
    );
  }

  return <AuthForm mode="register" invite={invite} firstRun={isFirstUser()} />;
}
