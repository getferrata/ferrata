import { describe, expect, it } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("round-trips a password and records the cost in the hash", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphras", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("still verifies the legacy salt:key format, so old logins survive", async () => {
    // How the previous version stored hashes: Node-default cost, "salt:key".
    const salt = randomBytes(16).toString("hex");
    const legacy = `${salt}:${scryptSync("old-password", salt, 64).toString("hex")}`;
    expect(legacy.includes("$")).toBe(false);
    expect(await verifyPassword("old-password", legacy)).toBe(true);
    expect(await verifyPassword("nope", legacy)).toBe(false);
  });

  it("returns false on a malformed stored value instead of throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$salt$key")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
