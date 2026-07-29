import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import sanitizeHtml from "sanitize-html";
import { getCredentialForUrl } from "./credentials";
import { readCapped } from "@/lib/http/body";

/**
 * Ingest a web page as course material: paste a link (a wiki page, a doc site)
 * instead of copy-pasting it. Convenience, done safely.
 *
 * Fetching an arbitrary URL server-side is a classic SSRF hole (internal
 * metadata endpoints, localhost, private ranges), so every URL (and every
 * redirect it follows) must resolve to a PUBLIC address or it's refused.
 * Self-hosters whose wiki lives on the internal network can opt out with
 * FERRATA_ALLOW_PRIVATE_URLS=1: an operator decision, never a request one.
 *
 * Failures carry a KIND so the UI can say what actually happened and offer
 * the right way out: credentials for a login wall, export files for a bot
 * wall. Bot protections are never bypassed.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MIN_TEXT = 200; // below this, treat as empty / login wall
const MAX_REDIRECTS = 4;

export type UrlErrorKind =
  | "invalid"
  | "private"
  | "unreachable"
  | "auth"
  | "bot"
  | "http"
  | "empty"
  | "too-large";

export interface UrlFetchResult {
  ok: boolean;
  text?: string;
  finalUrl?: string;
  error?: string;
  errorKind?: UrlErrorKind;
}

class UrlError extends Error {
  constructor(
    message: string,
    readonly kind: UrlErrorKind,
  ) {
    super(message);
  }
}

function allowPrivate(): boolean {
  return process.env.FERRATA_ALLOW_PRIVATE_URLS === "1";
}

/** True for loopback, link-local, private, and reserved ranges (v4 + v6). */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number) as [number, number, number, number];
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local incl. 169.254.169.254
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return isPrivateIp(s.slice(7)); // v4-mapped
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
  return false;
}

/** Parse + SSRF-guard a URL. Resolves the host and refuses internal addresses. */
/**
 * A validated URL, plus the address it resolved to at validation time.
 *
 * The address is carried out so the connection can be pinned to it. Validating
 * a hostname and then handing the hostname to fetch resolves it a second time,
 * independently, and a hostile DNS server with a zero TTL can answer differently
 * the second time: public to pass the check, internal to be fetched. Pinning
 * removes the second lookup, so there is nothing left to change in between.
 *
 * `address` is null when there is nothing to pin: the caller disabled the guard
 * for a private network, or the URL already names an IP literal.
 */
export interface CheckedUrl {
  url: URL;
  address: string | null;
}

export async function assertPublicUrl(raw: string): Promise<CheckedUrl> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UrlError("not a valid URL", "invalid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlError("only http(s) links are allowed", "invalid");
  }
  if (allowPrivate()) return { url: u, address: null };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new UrlError("blocked: internal address", "private");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UrlError("blocked: internal address", "private");
    return { url: u, address: null };
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new UrlError("cannot resolve host", "unreachable");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new UrlError("blocked: resolves to an internal address", "private");
  }
  // Every answer was public, so any of them is safe to pin to.
  return { url: u, address: addrs[0]!.address };
}

/**
 * A dispatcher that connects to one specific address, whatever DNS says now.
 *
 * Built per request rather than cached: the address is only valid for the URL
 * that was just checked, and reusing one across hosts would send a request to
 * the wrong machine.
 */
function pinnedAgent(address: string): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, isIP(address));
      },
    },
  });
}

/** Strip a page to readable text: drop non-content regions, then remove markup. */
export function extractReadableText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  const text = sanitizeHtml(stripped, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
    .trim();
}

/** Classify an HTTP failure so the UI can offer the right way out. */
export function classifyHttpStatus(status: number, body: string): {
  kind: UrlErrorKind;
  error: string;
} {
  if (status === 401 || status === 407) {
    return {
      kind: "auth",
      error: "this page requires sign-in: add credentials for this site and retry",
    };
  }
  const challenge =
    /cloudflare|captcha|challenge|attention required|just a moment|access denied/i.test(
      body.slice(0, 4_000),
    );
  if (status === 403) {
    return challenge
      ? {
          kind: "bot",
          error:
            "blocked by the site's bot protection: use its export files or an API token instead",
        }
      : {
          kind: "auth",
          error: "access denied: add credentials for this site and retry",
        };
  }
  if (status === 404) return { kind: "http", error: "page not found (HTTP 404)" };
  return { kind: "http", error: `the site answered HTTP ${status}` };
}

/** Login-wall heuristics for pages that answer 200 with a sign-in screen. */
function looksLikeLoginWall(finalUrl: string, html: string): boolean {
  if (/\/(login|signin|sign-in|sso|auth)[/?]?/i.test(finalUrl)) return true;
  return /type="password"|log in to continue|sign in to continue/i.test(
    html.slice(0, 8_000),
  );
}

interface RawFetch {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  contentType?: string;
  body?: string;
  error?: string;
  errorKind?: UrlErrorKind;
}

/** Fetch with SSRF checks, timeout, size cap, and stored credentials. */
async function fetchRaw(raw: string): Promise<RawFetch> {
  let u: URL;
  let pinned: string | null;
  try {
    const checked = await assertPublicUrl(raw);
    u = checked.url;
    pinned = checked.address;
  } catch (e) {
    const kind = e instanceof UrlError ? e.kind : "invalid";
    return {
      ok: false,
      error: e instanceof Error ? e.message : "bad URL",
      errorKind: kind,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed by hand so every hop is SSRF-checked BEFORE it is
    // fetched: `redirect: "follow"` would let the browser chase a Location into
    // an internal address before any of our code runs. Credentials are rebuilt
    // per hop, so a redirect to another host never carries this host's secret.
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = {
        "user-agent": "FerrataBot/1.0 (+onboarding knowledge import)",
        accept: "text/html,text/plain,application/xhtml+xml,*/*",
      };
      const cred = getCredentialForUrl(u);
      if (cred && (u.protocol === "https:" || allowPrivate())) {
        headers.authorization =
          cred.kind === "basic"
            ? `Basic ${Buffer.from(`${cred.username ?? ""}:${cred.secret}`).toString("base64")}`
            : `Bearer ${cred.secret}`;
      }

      // Connect to the address the guard checked, instead of resolving the
      // hostname a second time. TLS still validates against the hostname, so a
      // pinned connection is not a weakened one; it just cannot be pointed
      // somewhere else between the check and the connection.
      const res = await fetch(u, {
        redirect: "manual",
        signal: ctrl.signal,
        headers,
        ...(pinned ? { dispatcher: pinnedAgent(pinned) } : {}),
      } as RequestInit);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break; // a redirect with no target: treat as the final response
        if (hop >= MAX_REDIRECTS) {
          return { ok: false, error: "too many redirects", errorKind: "http" };
        }
        let next: CheckedUrl;
        try {
          next = await assertPublicUrl(new URL(loc, u).toString());
        } catch (e) {
          const kind = e instanceof UrlError ? e.kind : "invalid";
          return {
            ok: false,
            error:
              kind === "private"
                ? "blocked: redirected to an internal address"
                : "blocked: bad redirect target",
            errorKind: kind,
          };
        }
        u = next.url;
        pinned = next.address;
        continue;
      }

      // Not a redirect: read the body with a running size cap, so a huge or
      // endless response is aborted instead of buffered whole into memory.
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, error: "page too large", errorKind: "too-large" };
      }
      const capped = await readCapped(res.body, MAX_BYTES);
      if (capped === null) {
        ctrl.abort();
        return { ok: false, error: "page too large", errorKind: "too-large" };
      }
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: u.toString(),
        contentType: res.headers.get("content-type") ?? "",
        body: capped.toString("utf8"),
      };
    }
    return { ok: false, error: "no response", errorKind: "unreachable" };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "timed out" : "unreachable (network, proxy, or firewall)",
      errorKind: "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL and return its readable text, or a classified error. */
export async function fetchUrlText(raw: string): Promise<UrlFetchResult> {
  const res = await fetchRaw(raw);
  if (!res.ok) {
    if (res.error) {
      return { ok: false, error: res.error, errorKind: res.errorKind };
    }
    const c = classifyHttpStatus(res.status ?? 0, res.body ?? "");
    return { ok: false, error: c.error, errorKind: c.kind };
  }
  const body = res.body ?? "";
  if (looksLikeLoginWall(res.finalUrl ?? raw, body)) {
    return {
      ok: false,
      error: "this page requires sign-in: add credentials for this site and retry",
      errorKind: "auth",
    };
  }
  const text = /html|xml/i.test(res.contentType ?? "")
    ? extractReadableText(body)
    : body.trim();
  if (text.length < MIN_TEXT) {
    return {
      ok: false,
      error: "no readable content: the page may require sign-in or block bots",
      errorKind: "empty",
    };
  }
  return { ok: true, text, finalUrl: res.finalUrl };
}

// ---------------------------------------------------------------------------
// Shallow crawl: expand a seed link into its same-site subpages, politely.
// ---------------------------------------------------------------------------

export const CRAWL_MAX_PAGES = 30;

/** Extract same-host links under the seed's path prefix, normalized. */
export function extractSameSiteLinks(
  html: string,
  base: URL,
  prefix: string,
): string[] {
  const out = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[2] ?? m[3] ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|javascript|tel):/i.test(href)) {
      continue;
    }
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.host !== base.host) continue;
    u.hash = "";
    if (!u.pathname.startsWith(prefix)) continue;
    // Skip obvious non-pages.
    if (/\.(png|jpe?g|gif|svg|css|js|ico|pdf|zip|woff2?)$/i.test(u.pathname)) {
      continue;
    }
    out.add(u.toString());
  }
  return [...out];
}

/** The directory the seed lives in: /wiki/ops/page -> /wiki/ops/. */
export function crawlPrefix(seed: URL): string {
  const path = seed.pathname;
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut + 1);
}

/** Minimal robots.txt: Disallow prefixes for User-agent: * (and our bot). */
export function parseRobots(txt: string): string[] {
  const disallow: string[] = [];
  let applies = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const ua = clean.match(/^user-agent:\s*(.+)$/i);
    if (ua && ua[1]) {
      const agent = ua[1].trim().toLowerCase();
      applies = agent === "*" || agent.includes("ferrata");
      continue;
    }
    const dis = clean.match(/^disallow:\s*(.*)$/i);
    if (dis && applies) {
      const path = (dis[1] ?? "").trim();
      if (path) disallow.push(path);
    }
  }
  return disallow;
}

async function robotsDisallows(origin: string): Promise<string[]> {
  const res = await fetchRaw(`${origin}/robots.txt`);
  if (!res.ok || !res.body) return [];
  return parseRobots(res.body);
}

/**
 * Expand seed URLs into same-site subpages (depth 1 from each seed), honoring
 * robots.txt, capped at `cap` total URLs. Seeds always come first, so a bad
 * subpage can never displace what the author explicitly pasted.
 */
export async function expandSeeds(
  seeds: string[],
  cap = CRAWL_MAX_PAGES,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const robotsCache = new Map<string, string[]>();

  for (const s of seeds) {
    const norm = s.trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }

  for (const seed of [...out]) {
    if (out.length >= cap) break;
    let base: URL;
    try {
      base = (await assertPublicUrl(seed)).url;
    } catch {
      continue; // the seed itself will fail honestly at ingest time
    }
    const res = await fetchRaw(seed);
    if (!res.ok || !res.body || !/html|xml/i.test(res.contentType ?? "")) continue;

    if (!robotsCache.has(base.origin)) {
      robotsCache.set(base.origin, await robotsDisallows(base.origin));
    }
    const disallows = robotsCache.get(base.origin) ?? [];

    const links = extractSameSiteLinks(res.body, base, crawlPrefix(base));
    for (const link of links) {
      if (out.length >= cap) break;
      if (seen.has(link)) continue;
      const path = new URL(link).pathname;
      if (disallows.some((d) => path.startsWith(d))) continue;
      seen.add(link);
      out.push(link);
    }
  }
  return out;
}
