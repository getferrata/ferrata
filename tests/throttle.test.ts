import { describe, expect, it, beforeEach } from "vitest";
import {
  checkThrottle,
  clearFailures,
  clientKey,
  recordFailure,
  resetThrottle,
} from "@/lib/auth/throttle";

beforeEach(() => resetThrottle());

describe("failed-attempt throttling", () => {
  it("allows an untouched key", () => {
    expect(checkThrottle("login:email:a@b.c")).toMatchObject({ allowed: true });
  });

  it("tolerates a handful of typos before refusing", () => {
    const key = "login:email:a@b.c";
    for (let i = 0; i < 7; i++) recordFailure(key);
    expect(checkThrottle(key).allowed).toBe(true);
    recordFailure(key);
    expect(checkThrottle(key).allowed).toBe(false);
  });

  it("says how long to wait", () => {
    const key = "k";
    for (let i = 0; i < 8; i++) recordFailure(key);
    const verdict = checkThrottle(key);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSec).toBeGreaterThan(0);
    expect(verdict.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it("forgets a key once the block expires", () => {
    const start = 1_000_000;
    const key = "k";
    for (let i = 0; i < 8; i++) recordFailure(key, start);
    expect(checkThrottle(key, start).allowed).toBe(false);
    expect(checkThrottle(key, start + 16 * 60 * 1000).allowed).toBe(true);
  });

  it("does not punish someone who then signs in correctly", () => {
    const key = "login:email:a@b.c";
    for (let i = 0; i < 5; i++) recordFailure(key);
    clearFailures(key);
    for (let i = 0; i < 7; i++) recordFailure(key);
    expect(checkThrottle(key).allowed).toBe(true);
  });

  it("counts each key on its own, so one user cannot lock out another", () => {
    for (let i = 0; i < 8; i++) recordFailure("login:email:victim@b.c");
    expect(checkThrottle("login:email:victim@b.c").allowed).toBe(false);
    expect(checkThrottle("login:email:someone@b.c").allowed).toBe(true);
  });

  it("starts a fresh window rather than blocking on old failures", () => {
    const start = 1_000_000;
    const key = "k";
    for (let i = 0; i < 7; i++) recordFailure(key, start);
    // An hour later the old window is gone, so this is failure one, not eight.
    recordFailure(key, start + 60 * 60 * 1000);
    expect(checkThrottle(key, start + 60 * 60 * 1000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("prefers the first forwarded address behind a proxy", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientKey(req)).toBe("203.0.113.9");
  });

  it("falls back to the real-ip header, then to a constant", () => {
    expect(
      clientKey(new Request("http://x/", { headers: { "x-real-ip": "198.51.100.4" } })),
    ).toBe("198.51.100.4");
    expect(clientKey(new Request("http://x/"))).toBe("unknown");
  });
});
