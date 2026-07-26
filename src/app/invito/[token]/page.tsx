import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FerrataMark } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/session";
import { readInvite, enrollByInvite, type InviteRefusal } from "@/lib/course/invite";
import { plainText } from "@/lib/text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invite" };

// Why the link does not work matters to whoever is holding it: "I mistyped
// this" and "someone already used it" need different next steps.
const REFUSAL: Record<InviteRefusal, { title: string; body: string }> = {
  unknown: {
    title: "Invalid invite",
    body: "This link doesn't match any invite. Check you copied all of it, or ask for a new one.",
  },
  expired: {
    title: "Invite expired",
    body: "Invite links last three days. Ask whoever invited you for a fresh one.",
  },
  used: {
    title: "Invite already used",
    body: "Each link works once, for one person. Ask for your own.",
  },
  revoked: {
    title: "Invite revoked",
    body: "Whoever runs this install cancelled this link.",
  },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const check = readInvite(token);

  if (!check.ok) {
    const { title, body } = REFUSAL[check.reason];
    return (
      <main className="mx-auto flex min-h-screen max-w-measure flex-col justify-center px-6 py-16">
        <FerrataMark className="mb-6 h-12 w-12 text-text" />
        <h1 className="font-serif text-step-3 leading-tight">{title}</h1>
        <p className="mt-3 text-step-0 text-text-muted">{body}</p>
        <Link
          href="/login"
          className="mt-6 inline-block text-step-0 text-accent underline underline-offset-2"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  const invite = check.invite;

  // Already signed in. A course invite enrolls them; an account invite has
  // nothing to give someone who already has an account.
  const user = await getCurrentUser();
  if (user) {
    if (invite.courseId) {
      enrollByInvite(token, user.id);
      redirect(`/courses/${invite.courseId}`);
    }
    redirect("/courses");
  }

  const isAuthor = invite.role === "examiner";

  return (
    <main className="mx-auto flex min-h-screen max-w-measure flex-col justify-center px-6 py-16">
      <FerrataMark className="mb-6 h-12 w-12 text-text" />
      <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
        You&rsquo;ve been invited
      </p>
      <h1 className="mt-2 max-w-measure font-serif text-step-3 leading-tight">
        {invite.courseTitle
          ? plainText(invite.courseTitle)
          : isAuthor
            ? "Build courses on this install"
            : "Join this install"}
      </h1>
      <p className="mt-4 max-w-measure text-step-0 text-text-muted">
        {invite.courseTitle
          ? "Create your account and you'll be enrolled in this course, ready to start."
          : isAuthor
            ? "Create your account and you'll be able to turn material into courses."
            : "Create your account to get started."}
      </p>
      <p className="mt-3 text-step--1 text-text-muted">
        This link works once, and only until{" "}
        {new Date(invite.expiresAt).toLocaleString()}.
      </p>
      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href={`/register?invite=${token}`}
          className="inline-flex min-h-[44px] items-center rounded bg-accent px-6 font-medium text-accent-contrast transition hover:opacity-90"
        >
          Create an account
        </Link>
        {invite.courseId ? (
          <Link
            href={`/login?invite=${token}`}
            className="inline-flex min-h-[44px] items-center rounded border border-text px-6 text-text transition hover:bg-bg-subtle"
          >
            I already have an account
          </Link>
        ) : null}
      </div>
    </main>
  );
}
