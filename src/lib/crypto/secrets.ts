import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getLogger } from "@/lib/log";

const log = getLogger("secrets");

/**
 * Encryption at rest for the values that are worth stealing: provider API keys
 * and the tokens for wikis behind a sign-in.
 *
 * The threat this addresses is a copy of the database leaving the machine, in a
 * backup, a support bundle, a snapshot of a volume. It does not protect against
 * someone who already has the server, since the key has to be readable by the
 * process that uses it.
 *
 * Keyed from FERRATA_SECRET_KEY. Unset means values are stored as they always
 * were, in the clear, because a self-hoster who upgrades without setting a
 * variable must not find every stored credential unreadable.
 */

const PREFIX = "enc.v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function keyMaterial(): Buffer | null {
  const raw = process.env.FERRATA_SECRET_KEY?.trim();
  if (!raw) return null;
  if (raw.length < 16) {
    log.warn("FERRATA_SECRET_KEY is shorter than 16 characters; using it anyway");
  }
  // Any passphrase becomes a 32-byte key. Not a password KDF: this is a machine
  // secret from a config file, not something a human types at a prompt.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptionEnabled(): boolean {
  return keyMaterial() !== null;
}

/** Encrypt for storage. Returns the value unchanged when no key is configured. */
export function sealSecret(plain: string): string {
  const key = keyMaterial();
  if (!key || plain === "") return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(
      ".",
    )
  );
}

/**
 * Read a stored value. Anything without the marker is a plaintext value written
 * before encryption was switched on, and is returned as it is, so turning the
 * key on does not strand what is already there.
 */
export function openSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = keyMaterial();
  if (!key) {
    log.error("a stored value is encrypted but FERRATA_SECRET_KEY is not set");
    return "";
  }
  const [ivB64, tagB64, bodyB64] = stored.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !bodyB64) {
    log.error("a stored value is malformed and cannot be decrypted");
    return "";
  }
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or the row was tampered with. Both mean the same to a caller:
    // this secret is not usable, and pretending otherwise would send a broken
    // key to a provider and report an unhelpful error.
    log.error("a stored value failed to decrypt; the key may have changed");
    return "";
  }
}

/** True when the stored form is encrypted, for reporting state in the UI. */
export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
