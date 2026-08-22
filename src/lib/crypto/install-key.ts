import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * A stable secret belonging to this install, for signing rather than sealing.
 *
 * Derived once and kept in the settings table, not generated per process: a
 * signature is only worth anything if the key that made it is still there to
 * check it against, and a per-process key would make every document
 * unverifiable the moment the server restarted.
 *
 * Deliberately not the same key the redaction tokens use, even though both
 * could come from FERRATA_SECRET_KEY. Sharing one would mean rotating it to
 * invalidate old attestations also rewrites every protected value in every
 * course, and the two have no reason to move together.
 */
const cache = new Map<string, string>();

export function installSecret(settingKey: string): string {
  const cached = cache.get(settingKey);
  if (cached) return cached;

  const stored = getSetting(settingKey);
  if (stored) {
    cache.set(settingKey, stored);
    return stored;
  }

  const fresh = randomBytes(32).toString("hex");
  setSetting(settingKey, fresh);
  cache.set(settingKey, fresh);
  return fresh;
}

/** Drop the memoised key, for tests and for a rotation taking effect at once. */
export function forgetInstallSecret(settingKey?: string): void {
  if (settingKey) cache.delete(settingKey);
  else cache.clear();
}
