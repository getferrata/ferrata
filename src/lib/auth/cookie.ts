/**
 * The session cookie's attributes, and what to tell somebody whose browser
 * refuses it.
 *
 * In production the cookie is Secure, so a browser only keeps it over HTTPS or
 * on localhost. Anyone who puts the install on another machine and opens it over
 * plain http (a VM, a NAS, a container on the office network, which is what the
 * quick start invites) used to sign in "successfully" and land back on the sign-in
 * page with no word of explanation: the server set the cookie, the browser threw
 * it away. The default stays Secure, because weakening it for everybody to help
 * that case is the wrong trade. An operator who knows the network is trusted can
 * say so, and the form now notices when the cookie was not kept and says why.
 */
export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

export function sessionCookieOptions(
  maxAgeSeconds: number,
  env: Record<string, string | undefined> = process.env,
): SessionCookieOptions {
  const insecureAllowed = env.FERRATA_INSECURE_COOKIES === "1";
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.NODE_ENV === "production" && !insecureAllowed,
    maxAge: maxAgeSeconds,
  };
}

export const COOKIE_REFUSED_MESSAGE =
  "You signed in, but this browser did not keep the session. That usually means " +
  "this page is served over plain http from an address other than localhost. " +
  "Open it over https, or ask whoever runs this install to set " +
  "FERRATA_INSECURE_COOKIES=1 (only for a network you trust).";

/** Did the sign-in actually leave a session the server can see? */
export function sessionWasKept(me: unknown): boolean {
  return typeof me === "object" && me !== null && "user" in me && me.user != null;
}
