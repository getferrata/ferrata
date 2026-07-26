import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { webCredentials } from "@/db/schema";
import { newId } from "@/lib/util/id";
import { openSecret, sealSecret } from "@/lib/crypto/secrets";

/**
 * Per-host credentials for linked KB sources, so a wiki behind sign-in works
 * from a pasted link. Stored locally, attached automatically by the fetcher,
 * masked everywhere in the UI.
 */

export interface WebCredential {
  id: string;
  host: string;
  kind: "basic" | "bearer";
  username: string | null;
  secret: string;
}

export function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  try {
    // Accept either a bare host or a full URL.
    const u = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname;
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}

/** Exact host or a subdomain of the stored host. */
export function hostMatches(stored: string, host: string): boolean {
  return host === stored || host.endsWith(`.${stored}`);
}

export function listCredentials(): WebCredential[] {
  // Decrypted on the way out, so every caller sees the usable value and none of
  // them has to remember that the column is encrypted.
  return (
    db
      .select()
      .from(webCredentials)
      .orderBy(desc(webCredentials.createdAt))
      .all() as WebCredential[]
  ).map((c) => ({ ...c, secret: openSecret(c.secret) }));
}

export function addCredential(input: {
  host: string;
  kind: "basic" | "bearer";
  username?: string | null;
  secret: string;
}): WebCredential {
  const host = normalizeHost(input.host);
  const row = {
    id: newId("cred"),
    host,
    kind: input.kind,
    username: input.username?.trim() || null,
    secret: input.secret.trim(),
  };
  // One credential per host: replace an existing one instead of stacking.
  const existing = db
    .select({ id: webCredentials.id })
    .from(webCredentials)
    .where(eq(webCredentials.host, host))
    .get();
  if (existing) {
    db.delete(webCredentials).where(eq(webCredentials.id, existing.id)).run();
  }
  db.insert(webCredentials)
    .values({ ...row, secret: sealSecret(row.secret) })
    .run();
  return row as WebCredential;
}

export function deleteCredential(id: string): void {
  db.delete(webCredentials).where(eq(webCredentials.id, id)).run();
}

/** The credential to use for a URL, if any. Most specific host wins. */
export function getCredentialForUrl(u: URL): WebCredential | null {
  const host = u.hostname.toLowerCase();
  const all = listCredentials().filter((c) => hostMatches(c.host, host));
  if (all.length === 0) return null;
  all.sort((a, b) => b.host.length - a.host.length);
  return all[0] ?? null;
}
