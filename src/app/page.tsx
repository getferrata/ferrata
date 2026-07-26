import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * The app is the product; the marketing site lives in its own repository.
 * The root routes people straight to the right place.
 */
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/courses" : "/login");
}
