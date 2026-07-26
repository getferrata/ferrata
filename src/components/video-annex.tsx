"use client";

import { useState } from "react";
import { embedUrl, type VideoRef } from "@/lib/video";

/**
 * Per-concept video annex (decision A). We propose a YouTube search for the
 * concept; you paste a URL and it embeds. Local-only; the module text never
 * depends on it.
 */
export function VideoAnnex({
  courseId,
  conceptId,
  searchHref,
  initialRefs,
}: {
  courseId: string;
  conceptId: string;
  searchHref: string;
  initialRefs: VideoRef[];
}) {
  const [refs, setRefs] = useState<VideoRef[]>(initialRefs);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/concepts/${conceptId}/video`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        },
      );
      const data = (await res.json()) as { refs?: VideoRef[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setRefs(data.refs ?? refs);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-14 border-t border-border pt-8" aria-label="Video">
      <h2 className="font-serif text-step-2">Video</h2>
      <p className="mt-2 max-w-measure text-step--1 text-text-muted">
        A video is an annex, not the module&rsquo;s source. Search and add
        whatever helps you.
      </p>

      {refs.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-6">
          {refs.map((r) => (
            <li
              key={r.videoId}
              className="overflow-hidden rounded border border-border"
            >
              <div className="relative h-0 w-full pb-[56.25%]">
                <iframe
                  src={embedUrl(r.videoId)}
                  title={r.title ?? "Video"}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={searchHref}
          target="_blank"
          rel="noreferrer"
          className="tap text-step--1 text-accent underline underline-offset-2"
        >
          Search on YouTube
        </a>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-step--1 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || url.trim().length < 5}
          className="min-h-[36px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error ? <p className="mt-2 text-step--1 text-danger">{error}</p> : null}
    </section>
  );
}
