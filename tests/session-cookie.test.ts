import { describe, expect, it } from "vitest";
import {
  COOKIE_REFUSED_MESSAGE,
  sessionCookieOptions,
  sessionWasKept,
} from "@/lib/auth/cookie";

describe("the session cookie", () => {
  it("is Secure in production, which is the default that must not weaken", () => {
    expect(sessionCookieOptions(100, { NODE_ENV: "production" }).secure).toBe(true);
  });

  it("is not Secure in development, where it would not survive plain http", () => {
    expect(sessionCookieOptions(100, { NODE_ENV: "development" }).secure).toBe(false);
  });

  it("is only relaxed by an explicit FERRATA_INSECURE_COOKIES=1 from the operator", () => {
    const prod = { NODE_ENV: "production" };
    expect(sessionCookieOptions(100, { ...prod, FERRATA_INSECURE_COOKIES: "1" }).secure).toBe(false);
    // Anything that is not exactly 1 leaves it Secure: no "true", no "yes", no "0".
    for (const v of ["true", "yes", "0", "", " 1"]) {
      expect(sessionCookieOptions(100, { ...prod, FERRATA_INSECURE_COOKIES: v }).secure, v).toBe(true);
    }
  });

  it("is always HttpOnly, SameSite=Lax and site-wide, whatever the operator chose", () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", FERRATA_INSECURE_COOKIES: "1" }, {}]) {
      expect(sessionCookieOptions(100, env)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 100 });
    }
  });
});

describe("noticing that the browser threw the cookie away", () => {
  it("sees a session as kept only when the server can name the user", () => {
    expect(sessionWasKept({ user: { id: "u", email: "a@b.c" } })).toBe(true);
    expect(sessionWasKept({ user: null })).toBe(false);
    expect(sessionWasKept(null)).toBe(false);
    expect(sessionWasKept(undefined)).toBe(false);
    expect(sessionWasKept("nope")).toBe(false);
    expect(sessionWasKept({})).toBe(false);
  });

  it("explains the cause and the way out, instead of showing nothing", () => {
    expect(COOKIE_REFUSED_MESSAGE).toMatch(/plain http/);
    expect(COOKIE_REFUSED_MESSAGE).toMatch(/https/);
    expect(COOKIE_REFUSED_MESSAGE).toMatch(/FERRATA_INSECURE_COOKIES=1/);
  });
});
