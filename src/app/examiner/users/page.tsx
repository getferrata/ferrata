import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireExaminer } from "@/lib/auth/session";
import { SiteHeader } from "@/components/site-header";
import { UserRowActions } from "@/components/user-row-actions";
import { AccountInvites } from "@/components/account-invites";
import { listPendingInvites } from "@/lib/course/invite";
import { balanceFor } from "@/lib/llm/credits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireExaminer();
  const rows = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .all();
  const pending = listPendingInvites();
  // What each account has actually spent, so a runaway shows up here first.
  const spend = new Map(rows.map((u) => [u.id, balanceFor(u.id)]));

  return (
    <>
      <SiteHeader
        right={
          <Link
            href="/examiner"
            className="tap text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            Students
          </Link>
        }
      />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">Users</h1>
        <p className="mt-2 max-w-measure text-step-0 text-text-muted">
          Who has access to this install. Change a role, reset a password, or
          remove an account.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-step--1">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Credits used</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 text-text">{u.name}</td>
                  <td className="py-3 pr-4 text-text-muted">{u.email}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        "rounded border px-2 py-0.5 " +
                        (u.role === "examiner"
                          ? "border-accent text-accent"
                          : "border-border text-text-muted")
                      }
                    >
                      {u.role === "examiner" ? "examiner" : "student"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-text-muted">
                    {spend.get(u.id)?.spent ?? 0}
                    {spend.get(u.id)?.limit != null
                      ? ` / ${spend.get(u.id)?.limit}`
                      : ""}
                  </td>
                  <td className="py-3">
                    <UserRowActions
                      userId={u.id}
                      role={u.role}
                      isSelf={u.id === me.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AccountInvites pending={pending} />
      </main>
    </>
  );
}
