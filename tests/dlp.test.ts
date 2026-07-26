import { describe, expect, it } from "vitest";
import { scanSensitivity } from "@/lib/sources/dlp";

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
    // …replaced by a restore token, and captured for later restoration
    expect(r.text).toMatch(/⟨cxt:[0-9a-f]{10}⟩/);
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
