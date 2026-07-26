/**
 * Learning-state chip: the only place the three semantic colors appear, and
 * always paired with a glyph + label so meaning is never carried by color alone
 * (WCAG 1.4.1).
 */
export type LearningState = "solid" | "doubt" | "untested";

const MAP: Record<
  LearningState,
  { label: string; color: string; glyph: string }
> = {
  solid: { label: "solid", color: "var(--state-solid)", glyph: "●" },
  doubt: { label: "shaky", color: "var(--state-doubt)", glyph: "◐" },
  untested: { label: "untested", color: "var(--state-untested)", glyph: "○" },
};

export function StateChip({
  state,
  className,
}: {
  state: LearningState;
  className?: string;
}) {
  const s = MAP[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-step--1 ${className ?? ""}`}
      style={{ color: s.color }}
    >
      <span aria-hidden>{s.glyph}</span>
      <span>{s.label}</span>
    </span>
  );
}
