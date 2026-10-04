/**
 * Response headers sent on every route.
 *
 * Found missing on a clean install: nothing told a browser not to frame the app
 * (so a page on another site could sit invisibly over the sign-in form or the
 * settings page and take the clicks), not to guess content types, or how much of
 * the address to leak to other sites.
 *
 * Deliberately not here: a Content-Security-Policy, which Next's inline scripts
 * make a project of its own, and Strict-Transport-Security, which only means
 * something over HTTPS and belongs on the proxy that terminates it.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];
