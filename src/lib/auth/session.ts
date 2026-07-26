import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, users, type UserRole } from "@/db/schema";
import { newId, now } from "@/lib/util/id";

const COOKIE = "ferrata_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

// The cookie carries an opaque random token; only its sha-256 is stored, so a
// leaked DB never yields a usable session cookie.
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  db.insert(authSessions)
    .values({ id: hash(token), userId, expiresAt: now() + TTL_MS })
    .run();
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    db.delete(authSessions).where(eq(authSessions.id, hash(token))).run();
    jar.delete(COOKIE);
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      exp: authSessions.expiresAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.id, hash(token)))
    .get();
  if (!row || row.exp < now()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Server-side guard: return the user or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guard for examiner-only surfaces. */
export async function requireExaminer(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "examiner") redirect("/courses");
  return user;
}

/** Is this the very first user? (used to seed the first examiner). */
export function isFirstUser(): boolean {
  return !db.select({ id: users.id }).from(users).limit(1).get();
}

export function newUserId(): string {
  return newId("user");
}
