import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt from Node's stdlib, no external dependency.
 *
 * Async on purpose: at the current cost a hash takes ~100ms, and the app is a
 * single Node process, so `scryptSync` would block the event loop on every
 * login. The libuv thread pool runs the async form off the main thread.
 *
 * New hashes are stored as "scrypt$<N>$<salt>$<key>" so the cost is recorded
 * with the hash and can be raised later without stranding old accounts. The
 * earlier "salt:key" format (Node's default cost) is still verified, so no
 * existing login breaks.
 */
const KEYLEN = 64;
// OWASP-current scrypt cost. maxmem has to clear ~128 * N * r bytes.
const N = 1 << 17;
const R = 8;
const P = 1;
const MAXMEM = 256 * 1024 * 1024;

interface ScryptOpts {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOpts,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (
    await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  ).toString("hex");
  return `scrypt$${N}$${salt}$${derived}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("scrypt$")) {
    const [, nStr, salt, derivedHex] = stored.split("$");
    const n = Number(nStr);
    if (!salt || !derivedHex || !Number.isInteger(n) || n <= 0) return false;
    const expected = Buffer.from(derivedHex, "hex");
    const actual = await scryptAsync(password, salt, KEYLEN, {
      N: n,
      r: R,
      p: P,
      maxmem: MAXMEM,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  // Legacy "salt:derivedKey" at Node's default cost.
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const expected = Buffer.from(derivedHex, "hex");
  const actual = await scryptAsync(password, salt, KEYLEN);
  // Constant-time compare; guard length first (timingSafeEqual throws on mismatch).
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
