/**
 * The authoring/generation journey as a via ferrata: a fixed cable with anchors
 * (the phases), and the carabiner clipped at the current one. As the pipeline
 * advances the clip slides up to the next anchor; the segment being climbed
 * shimmers. Reuses the brand mark so the logo itself is the progress indicator.
 *
 * Pure presentational: it animates purely from prop changes (CSS transitions),
 * so a polling parent that re-renders with a new `current`/`percent` gets a
 * smooth climb for free.
 */
import { FerrataMark } from "@/components/brand";

export function CableProgress({
  steps,
  current,
  percent,
  failed = false,
  className,
}: {
  /** Ordered phase labels, bottom (start) to top (finish). */
  steps: readonly string[];
  /** 1-based index of the active phase. */
  current: number;
  /** Optional 0..100 progress within the active phase (fills toward the next anchor). */
  percent?: number;
  failed?: boolean;
  className?: string;
}) {
  const total = steps.length;
  const last = Math.max(1, total - 1);

  // Fraction (0 = bottom/start, 1 = top/finish) where the clip sits. Within the
  // active phase we nudge it toward the next anchor by `percent`.
  const base = (current - 1) / last;
  const next = Math.min(current, last) / last;
  const within =
    percent != null ? Math.max(0, Math.min(1, percent / 100)) : 0;
  const pos = Math.min(1, base + (next - base) * within);

  // We lay the cable out top(finish) -> bottom(start), so a higher fraction is
  // higher up. Convert fraction to a CSS "top" percentage (0% = finish at top).
  const topPct = (frac: number) => (1 - frac) * 100;
  const perStep = 64; // px between anchors
  const railHeight = last * perStep;

  return (
    <div className={"flex gap-4 " + (className ?? "")}>
      {/* the cable rail */}
      <div
        className="relative w-8 shrink-0"
        style={{ height: railHeight }}
        aria-hidden
      >
        {/* full cable */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-border" />
        {/* climbed portion (from bottom up to the clip) */}
        <div
          className={
            "absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-[height] duration-700 ease-out " +
            (failed ? "bg-danger" : "bg-accent")
          }
          style={{ bottom: 0, height: `${pos * 100}%` }}
        />
        {/* shimmer on the segment currently being climbed */}
        {!failed && percent != null && (
          <div
            className="absolute left-1/2 w-[3px] -translate-x-1/2 animate-pulse rounded-full bg-accent/60"
            style={{
              bottom: `${topPct(next) === 0 ? 0 : (base * 100)}%`,
              height: `${Math.max(0, (pos - base) * 100)}%`,
            }}
          />
        )}

        {/* anchors */}
        {steps.map((label, i) => {
          const frac = i / last;
          const done = i + 1 < current;
          const active = i + 1 === current;
          return (
            <span
              key={label}
              className={
                "absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 " +
                (failed && active
                  ? "border-danger bg-danger"
                  : done
                    ? "border-accent bg-accent"
                    : active
                      ? "border-accent bg-bg"
                      : "border-border bg-bg")
              }
              style={{ top: `${topPct(frac)}%` }}
            />
          );
        })}

        {/* the carabiner, clipped at the current position */}
        <span
          className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-[top] duration-700 ease-out"
          style={{ top: `${topPct(pos)}%` }}
        >
          <FerrataMark
            className={
              "h-7 w-7 drop-shadow-sm " +
              (failed ? "text-danger" : "text-text")
            }
            title="Progress"
          />
        </span>
      </div>

      {/* labels, aligned to the anchors */}
      <ol
        className="relative flex-1"
        style={{ height: railHeight }}
      >
        {steps.map((label, i) => {
          const frac = i / last;
          const done = i + 1 < current;
          const active = i + 1 === current;
          return (
            <li
              key={label}
              className={
                "absolute -translate-y-1/2 whitespace-nowrap text-step-0 " +
                (active
                  ? "font-medium text-text"
                  : done
                    ? "text-text-muted"
                    : "text-text-muted/70")
              }
              style={{ top: `${topPct(frac)}%` }}
            >
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
