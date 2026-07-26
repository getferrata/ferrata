import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

/**
 * The create screen is a client component, so its gate lives here: building a
 * course spends on the install's key and is an examiner's job.
 */
export default async function CreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (user.role !== "examiner") notFound();
  return <>{children}</>;
}
