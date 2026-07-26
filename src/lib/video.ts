/**
 * YouTube helpers for the per-concept video annex (decision A). Local-only,
 * behind FERRATA_ALLOW_VIDEO. The generated text never depends on a video; a
 * video is an annex added after the module exists.
 */

export interface VideoRef {
  videoId: string;
  url: string;
  title?: string;
}

/** Extract the 11-char video id from any common YouTube URL, else null. */
export function parseYouTubeId(input: string): string | null {
  const url = input.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  // bare id
  if (/^[\w-]{11}$/.test(url)) return url;
  return null;
}

export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

/** The search query proposed for a concept (the user confirms/pastes a URL). */
export function searchUrl(conceptTitle: string, domain: string): string {
  const q = encodeURIComponent(`${conceptTitle} ${domain}`.trim());
  return `https://www.youtube.com/results?search_query=${q}`;
}

export function isVideoEnabled(): boolean {
  return (process.env.FERRATA_ALLOW_VIDEO ?? "true").toLowerCase() !== "false";
}

export function parseRefs(json: string | null): VideoRef[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (r): r is VideoRef =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as VideoRef).videoId === "string",
    );
  } catch {
    return [];
  }
}
