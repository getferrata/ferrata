import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from Node's stdlib, no external dependency.
 * Stored as "salt:derivedKey" hex.
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const expected = Buffer.from(derivedHex, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  // Constant-time compare; guard length first (timingSafeEqual throws on mismatch).
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
