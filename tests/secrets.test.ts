import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  encryptionEnabled,
  isSealed,
  openSecret,
  sealSecret,
} from "@/lib/crypto/secrets";

const KEY = "a-machine-secret-for-tests-0123456789";

beforeEach(() => {
  delete process.env.FERRATA_SECRET_KEY;
});
afterEach(() => {
  delete process.env.FERRATA_SECRET_KEY;
});

describe("with no key configured", () => {
  it("stores values exactly as they were", () => {
    expect(encryptionEnabled()).toBe(false);
    expect(sealSecret("sk-live-123")).toBe("sk-live-123");
  });

  it("reads plaintext back unchanged", () => {
    expect(openSecret("sk-live-123")).toBe("sk-live-123");
  });

  it("refuses to guess at an encrypted value rather than returning nonsense", () => {
    process.env.FERRATA_SECRET_KEY = KEY;
    const sealed = sealSecret("sk-live-123");
    delete process.env.FERRATA_SECRET_KEY;
    expect(openSecret(sealed)).toBe("");
  });
});

describe("with a key configured", () => {
  beforeEach(() => {
    process.env.FERRATA_SECRET_KEY = KEY;
  });

  it("round-trips a secret", () => {
    const sealed = sealSecret("sk-live-123");
    expect(sealed).not.toContain("sk-live-123");
    expect(isSealed(sealed)).toBe(true);
    expect(openSecret(sealed)).toBe("sk-live-123");
  });

  it("produces a different ciphertext each time", () => {
    // A fresh nonce per write, so two accounts using the same provider key do
    // not produce identical rows that give the reuse away.
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("still reads values written before encryption was switched on", () => {
    // The upgrade path: a database full of plaintext must keep working the
    // moment the key is set, not become unreadable.
    expect(openSecret("plaintext-from-before")).toBe("plaintext-from-before");
  });

  it("leaves an empty value alone", () => {
    expect(sealSecret("")).toBe("");
  });

  it("detects tampering instead of returning altered bytes", () => {
    const sealed = sealSecret("sk-live-123");
    const parts = sealed.slice("enc.v1:".length).split(".");
    const body = Buffer.from(parts[2] as string, "base64");
    body[0] = (body[0]! ^ 0xff) & 0xff;
    const tampered = `enc.v1:${parts[0]}.${parts[1]}.${body.toString("base64")}`;
    expect(openSecret(tampered)).toBe("");
  });

  it("returns nothing when the key has changed", () => {
    const sealed = sealSecret("sk-live-123");
    process.env.FERRATA_SECRET_KEY = "a-completely-different-machine-secret";
    expect(openSecret(sealed)).toBe("");
  });

  it("survives values that are not ascii", () => {
    const value = "clé-secrète-éè-你好";
    expect(openSecret(sealSecret(value))).toBe(value);
  });

  it("refuses a malformed envelope", () => {
    expect(openSecret("enc.v1:not-really")).toBe("");
  });
});
