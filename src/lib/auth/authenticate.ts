import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

// A real hash, made once, to spend the same time on an email nobody has. Without
// it the refusal for an unknown address comes back in microseconds and one for a
// known address in ~100ms, which tells anyone who asks which emails are users.
let decoy: Promise<string> | undefined;

/** The user for this email and password, or null. */
export async function authenticate(email: string, password: string) {
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    decoy ??= hashPassword("decoy-" + Math.random());
    try {
      await verifyPassword(password, await decoy);
    } catch (err) {
      decoy = undefined; // a rejected promise kept here would fail every later login
      throw err;
    }
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  // The check above takes ~100ms. A password reset that commits inside that
  // window has already ended this account's sessions; signing in with the old
  // password now would hand the person it was reset against a fresh one. The
  // read and the caller's session insert run without an await between them.
  const current = db.select({ h: users.passwordHash }).from(users).where(eq(users.id, user.id)).get();
  return current?.h === user.passwordHash ? user : null;
}
