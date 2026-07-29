import { describe, expect, it } from "vitest";
import { clusterOverlaps, scanSensitivity } from "@/lib/sources/dlp";

describe("scanSensitivity (Contextia DLP gate)", () => {
  it("passes clean text through as public with no redactions", async () => {
    const text = "Il ledger è append-only. Ogni movimento sono due righe.";
    const r = await scanSensitivity(text, "runbook.md");
    expect(r.text).toBe(text);
    expect(r.verdict?.level).toBe("public");
    expect(r.verdict?.redactions).toBe(0);
  });

  it("redacts a live credential and never returns the secret value", async () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const text = `deploy config\nAWS_SECRET_ACCESS_KEY=${secret}\nend`;
    const r = await scanSensitivity(text, "deploy.env");
    expect(r.text).not.toContain(secret);
    expect(r.verdict).not.toBeNull();
    expect(r.verdict!.redactions).toBeGreaterThan(0);
    expect(r.verdict!.level).toBe("restricted");
    // The stored verdict must carry no secret value.
    expect(JSON.stringify(r.verdict)).not.toContain(secret);
    // …but it does explain what was found.
    expect(r.verdict!.findings.length).toBeGreaterThan(0);
    expect(r.verdict!.findings[0]!.rationale.length).toBeGreaterThan(0);
  });

  it("tokenizes an operational value (private IP) reversibly, not the secret way", async () => {
    const text = "Il server di bordo risponde su 10.0.0.5 in produzione.";
    const r = await scanSensitivity(text, "runbook.md");
    // the real value is gone from the text…
    expect(r.text).not.toContain("10.0.0.5");
    // …replaced by a restore token, and captured for later restoration. The
    // token is an HMAC (not a plain hash), so it cannot be reversed to the IP
    // from a shared package without the install's key.
    expect(r.text).toMatch(/⟨cxt:[0-9a-f]{16}⟩/);
    expect(r.restorations.length).toBe(1);
    expect(r.restorations[0]!.value).toBe("10.0.0.5");
    expect(r.verdict!.protectedValues).toBe(1);
  });

  it("aggregates repeated findings of the same type by count", async () => {
    const text =
      "k1=AKIAIOSFODNN7EXAMPLE\nk2=AKIAIOSFODNN7EXAMPLE2X\nk3=AKIAIOSFODNN7EXAMPL3";
    const r = await scanSensitivity(text, "keys.env");
    const total = r.verdict!.findings.reduce((s, f) => s + f.count, 0);
    expect(total).toBe(r.verdict!.redactions);
  });

  it("mode 'off' is clamped to the operator floor (redact): the secret is still redacted", async () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const text = `AWS_SECRET_ACCESS_KEY=${secret}`;
    // Default floor is redact: an author choosing "off" cannot leak a secret.
    const r = await scanSensitivity(text, "deploy.env", "off");
    expect(r.text).not.toContain(secret);
    expect(r.verdict!.redactions).toBeGreaterThan(0);
  });

  it("mode 'off' passes everything through ONLY when the operator lowers the floor to off", async () => {
    const prev = process.env.CONTEXTIA_MODE;
    process.env.CONTEXTIA_MODE = "off";
    try {
      const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      const text = `AWS_SECRET_ACCESS_KEY=${secret}`;
      const r = await scanSensitivity(text, "deploy.env", "off");
      expect(r.text).toBe(text); // untouched: operator opted the whole instance out
      expect(r.verdict).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CONTEXTIA_MODE;
      else process.env.CONTEXTIA_MODE = prev;
    }
  });

  it("mode 'block' refuses a source that carries critical secrets", async () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const text = `AWS_SECRET_ACCESS_KEY=${secret}`;
    const r = await scanSensitivity(text, "deploy.env", "block");
    expect(r.blocked).toBe(true);
    expect(r.verdict!.level).toBe("restricted");
    // Still never leaks the secret.
    expect(r.text).not.toContain(secret);
  });

  it("mode 'block' does NOT block a source with only operational values", async () => {
    const text = "Il server risponde su 10.0.0.5.";
    const r = await scanSensitivity(text, "runbook.md", "block");
    expect(r.blocked).toBe(false); // no critical secrets → still usable
    expect(r.restorations.length).toBe(1);
  });
});

describe("what the engine could not read", () => {
  it("refuses a file it could only scan part of, instead of calling it clean", async () => {
    // The engine caps how much it reads. On a longer file an empty result means
    // "nothing in the part we read", and treating that as clean would send the
    // unread tail to the model and into every export.
    const secret = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const text = "a".repeat(1_000_001) + "\n" + secret;
    const r = await scanSensitivity(text, "huge.md");
    expect(r.blocked).toBe(true);
    expect(r.verdict!.level).toBe("restricted");
    expect(r.verdict!.findings[0]!.rationale).toMatch(/not checked|split/i);
  });

  it("blocks on an unread tail even in redact mode, which normally never blocks", async () => {
    const r = await scanSensitivity("b".repeat(1_000_001), "huge.md", "redact");
    expect(r.blocked).toBe(true);
  });

  it("still scans a file that fits", async () => {
    const r = await scanSensitivity("x".repeat(999_000), "big.md");
    expect(r.blocked).toBe(false);
    expect(r.verdict!.level).toBe("public");
  });
});

describe("findings that overlap", () => {
  const at = (
    type: string,
    severity: "critical" | "warning",
    start: number,
    end: number,
  ) => ({
    id: `${type}:${start}:${end}`,
    type,
    label: type,
    severity,
    start,
    end,
    match: "x".repeat(end - start),
    rationale: "",
  });

  // Synthetic findings on purpose: no detector pair in the engine produces this
  // shape today, which is exactly why the assumption needs a test rather than a
  // reader's confidence.
  it("covers the union, so a partly overlapped secret keeps no tail in clear", () => {
    const out = clusterOverlaps([
      at("email", "warning", 0, 20),
      at("aws_secret_access_key", "critical", 15, 60),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.end).toBe(60);
  });

  it("names the cluster after the more serious member, so it is not restored", () => {
    const out = clusterOverlaps([
      at("private_ip", "warning", 0, 20),
      at("aws_secret_access_key", "critical", 10, 30),
    ]);
    expect(out[0]!.type).toBe("aws_secret_access_key");
  });

  it("leaves findings that do not touch alone", () => {
    const out = clusterOverlaps([
      at("private_ip", "warning", 0, 8),
      at("private_ip", "warning", 20, 28),
    ]);
    expect(out).toHaveLength(2);
  });

  it("redacts a secret and a private IP that sit in one connection string", async () => {
    const text = "DATABASE_URL=postgres://admin:hunter2@10.0.0.5:5432/payments";
    const r = await scanSensitivity(text, "env.md");
    expect(r.text).not.toContain("hunter2");
    expect(r.text).not.toContain("10.0.0.5");
    for (const restoration of r.restorations) {
      expect(restoration.value).not.toContain("hunter2");
    }
  });
});

describe("the placeholder key survives a restart", () => {
  it("gives the same host the same placeholder across scans", async () => {
    // A key generated per process meant material added after a restart got a
    // different placeholder for the same host, so one machine appeared in the
    // course as two protected values, and the model, told to reproduce them
    // verbatim, saw two. The key is stored, so it outlives the process.
    delete process.env.FERRATA_SECRET_KEY;
    const first = await scanSensitivity(
      "The gateway lives at 10.1.2.3 today.",
      "runbook.md",
    );
    const second = await scanSensitivity(
      "Later notes also mention 10.1.2.3 for the gateway.",
      "notes.md",
    );
    const token = (s: string) => s.match(/\u27e8cxt:[0-9a-f]+\u27e9/)?.[0];
    expect(token(first.text)).toBeDefined();
    expect(token(second.text)).toBe(token(first.text));
  });
});
