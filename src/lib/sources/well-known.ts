/**
 * Addresses that identify nobody.
 *
 * Contextia is right to notice an IP address in uploaded material: most of them
 * say where somebody's machine is. These do not. They are fixed by an RFC, they
 * appear in every networking textbook, and knowing that a document contains
 * 10.0.0.0 tells a reader nothing about the author's estate, because every
 * private network on earth is inside one of three blocks.
 *
 * Treating them as protected broke a course rather than protecting anything. A
 * module called "Private addresses and NAT (RFC1918)" is about these three
 * numbers; the model wrote them from its own knowledge, never having been shown
 * the material's copy, and the export then refused the whole package because
 * the text "carried a protected value in clear". Six of them, all textbook.
 *
 * The test for adding one here is narrow: an RFC has to fix the value, so that
 * writing it down cannot describe anybody's network. A block's base address
 * passes. A host inside a block does not, however common: 192.168.1.1 is a
 * plausible router in a real office, and the fact that it is also a common
 * example is not a reason to stop protecting it.
 */

/** Exact values a detector may find and should let through. */
export const WELL_KNOWN_VALUES: readonly string[] = [
  // RFC 1918, the three private blocks as the RFC defines them.
  "10.0.0.0",
  "172.16.0.0",
  "192.168.0.0",
  // RFC 6598 carrier grade NAT, RFC 3927 link local, RFC 5771 multicast.
  "100.64.0.0",
  "169.254.0.0",
  "224.0.0.0",
  // Nowhere, here, and everyone.
  "0.0.0.0",
  "127.0.0.0",
  "127.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  // Masks. A netmask is a shape, not a place.
  "255.0.0.0",
  "255.255.0.0",
  "255.255.255.0",
];

/**
 * Regex sources for ranges where every address inside is reserved for writing
 * about networks, so none of them can ever be routed to a real machine.
 */
export const WELL_KNOWN_PATTERNS: readonly string[] = [
  // RFC 5737: the three documentation ranges.
  String.raw`^192\.0\.2\.\d{1,3}$`,
  String.raw`^198\.51\.100\.\d{1,3}$`,
  String.raw`^203\.0\.113\.\d{1,3}$`,
  // RFC 3849: the same idea for IPv6.
  String.raw`^2001:0?db8:`,
];

const COMPILED = WELL_KNOWN_PATTERNS.map((p) => new RegExp(p, "i"));
const EXACT = new Set(WELL_KNOWN_VALUES.map((v) => v.toLowerCase()));

/**
 * True for a value published in an RFC rather than belonging to anybody.
 *
 * Used twice, and the second use is the one that matters for courses that
 * already exist. Allowlisting at detection stops the next course tokenizing
 * these at all, but a course already built carries the tokens and its own
 * restore map, and rebuilding it costs money. So the export guard asks this
 * too: a textbook address appearing in a module is not a leak, whether or not
 * something once decided to protect it.
 */
export function isWellKnownAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return false;
  if (EXACT.has(v)) return true;
  return COMPILED.some((re) => re.test(v));
}
