import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

/**
 * Sets a new temporary password for a user, ends all their sessions, and
 * returns the password in the clear, once. Null when the user does not exist.
 */
export async function resetPassword(userId: string): Promise<string | null> {
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return null;
  // Readable temporary password (base64url of 9 bytes, about 12 chars).
  const temp = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(temp);
  // Same transaction: a reset exists for the case where somebody else got in,
  // and a session cookie that outlives it (they last 30 days) would leave them
  // signed in under the new password.
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    tx.delete(authSessions).where(eq(authSessions.userId, userId)).run();
  });
  return temp;
}
