import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRegistration } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (await getCurrentUser()) redirect(invite ? `/invito/${invite}` : "/courses");
  // An invited person landing here can still sign up, so pass the same
  // verdict the register page uses rather than a second, looser rule.
  return (
    <AuthForm
      mode="login"
      invite={invite}
      canRegister={checkRegistration(invite).ok}
    />
  );
}
