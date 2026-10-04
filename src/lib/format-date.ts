/**
 * Dates the way the interface writes them: day, month as a word, year.
 *
 * They were written four ways: the server's locale (the invite page read
 * "10/7/2026, 9:47:45 AM", which is 7 October or 10 July depending on who is
 * reading), the browser's, a hard-coded Italian format in an English interface,
 * and one explicit format. A month in letters cannot be misread.
 */
const DAY = { day: "numeric", month: "short", year: "numeric" } as const;
const MOMENT = { ...DAY, hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const;

type When = number | string | Date;

export function formatDate(when: When, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { ...DAY, timeZone }).format(new Date(when));
}

/** With the time and its zone, so a server in UTC does not pass as local time. */
export function formatDateTime(when: When, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { ...MOMENT, timeZone }).format(new Date(when));
}
