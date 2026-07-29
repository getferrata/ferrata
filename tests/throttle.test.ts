import { afterEach, describe, expect, it, beforeEach } from "vitest";
import {
  checkThrottle,
  clearFailures,
  clientKey,
  hitRateLimit,
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

describe("hitRateLimit (every call counts)", () => {
  const W = 5 * 60 * 1000;

  it("allows up to the limit, then refuses within the window", () => {
    const at = 1_000_000;
    for (let i = 0; i < 20; i++) {
      expect(hitRateLimit("feynman:u1", 20, W, at).allowed).toBe(true);
    }
    const over = hitRateLimit("feynman:u1", 20, W, at);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it("counts a concurrent burst as it happens, so it caps parallel spend", () => {
    // The route calls this synchronously before its await, so N parallel
    // requests each land here before any starts spending: only `limit` pass.
    const at = 2_000_000;
    const verdicts = Array.from({ length: 100 }, () =>
      hitRateLimit("feynman:burst", 20, W, at),
    );
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(20);
  });

  it("starts a fresh allowance once the window rolls over", () => {
    const at = 3_000_000;
    for (let i = 0; i < 20; i++) hitRateLimit("feynman:u2", 20, W, at);
    expect(hitRateLimit("feynman:u2", 20, W, at).allowed).toBe(false);
    expect(hitRateLimit("feynman:u2", 20, W, at + W).allowed).toBe(true);
  });

  it("keeps each user's allowance separate", () => {
    const at = 4_000_000;
    for (let i = 0; i < 20; i++) hitRateLimit("feynman:a", 20, W, at);
    expect(hitRateLimit("feynman:a", 20, W, at).allowed).toBe(false);
    expect(hitRateLimit("feynman:b", 20, W, at).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  afterEach(() => {
    delete process.env.FERRATA_TRUST_PROXY;
  });

  it("ignores the forwarded header unless the operator declared a proxy", () => {
    // The header is written by whoever is calling. Believing it by default gave
    // every request its own throttle key, so a brute force just varied the
    // header and never reached the limit.
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(clientKey(req)).toBeNull();
  });

  it("takes the rightmost hop behind a declared proxy", () => {
    process.env.FERRATA_TRUST_PROXY = "1";
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    // The leftmost entry is whatever the client claimed, even through an honest
    // proxy; the rightmost is the one that proxy appended itself.
    expect(clientKey(req)).toBe("10.0.0.1");
  });

  it("falls back to the real-ip header behind a declared proxy", () => {
    process.env.FERRATA_TRUST_PROXY = "1";
    expect(
      clientKey(new Request("http://x/", { headers: { "x-real-ip": "198.51.100.4" } })),
    ).toBe("198.51.100.4");
  });

  it("returns null rather than a shared name when there is nothing to trust", () => {
    // A constant would put every caller in one bucket, and eight failures from
    // anywhere would refuse everybody: the throttle would become the attack.
    process.env.FERRATA_TRUST_PROXY = "1";
    expect(clientKey(new Request("http://x/"))).toBeNull();
  });
});
