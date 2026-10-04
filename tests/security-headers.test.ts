import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { SECURITY_HEADERS } from "@/lib/security-headers";

describe("headers every response carries", () => {
  const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("stops the app being framed by another site", () => {
    expect(byKey["X-Frame-Options"]).toBe("DENY");
  });

  it("stops browsers guessing a content type, and limits what the address leaks", () => {
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("refuses the powerful features the app never uses", () => {
    for (const f of ["camera", "microphone", "geolocation"]) {
      expect(byKey["Permissions-Policy"]).toContain(`${f}=()`);
    }
  });

  it("is actually applied to every path by the Next configuration", async () => {
    // A list nobody wires up protects nothing: this is the check that it is.
    const rules = await nextConfig.headers?.();
    const all = rules?.find((r) => r.source === "/:path*");
    expect(all, "a rule for every path").toBeDefined();
    const sent = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    for (const h of SECURITY_HEADERS) expect(sent[h.key], h.key).toBe(h.value);
  });
});
