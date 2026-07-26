import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

/** Importing creates a course, so it is an examiner's screen. */
export default async function ImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (user.role !== "examiner") notFound();
  return <>{children}</>;
}
