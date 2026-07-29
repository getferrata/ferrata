/**
 * The confidence x correctness matrix: the four quadrants of what a learner
 * knows and what they think they know. The dangerous cell is bottom-left, wrong
 * but sure, the thing you cannot see about yourself. This is the picture the
 * readiness number is a summary of, and the one worth showing an examiner.
 */
export interface MatrixCounts {
  solid: number; // right, and sure
  underconfident: number; // right, but unsure
  honestGap: number; // wrong, and knew it
  blindSpot: number; // wrong, but sure
}

function Cell({
  n,
  title,
  hint,
  color,
  emphasise = false,
}: {
  n: number;
  title: string;
  hint: string;
  color: string;
  emphasise?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col gap-1 rounded border p-4 " +
        (emphasise && n > 0 ? "border-2" : "border")
      }
      style={{ borderColor: color }}
    >
      <span className="font-serif text-step-3 leading-none" style={{ color }}>
        {n}
      </span>
      <span className="text-step--1 font-medium text-text">{title}</span>
      <span className="text-step--1 text-text-muted">{hint}</span>
    </div>
  );
}

export function KnowledgeMatrix({ m }: { m: MatrixCounts }) {
  const total = m.solid + m.underconfident + m.honestGap + m.blindSpot;
  if (total === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="font-serif text-step-2">What you know, and what you think you know</h2>
      <p className="mt-1 max-w-measure text-step--1 text-text-muted">
        Every answered test, placed by whether you got it right and how sure you
        were. The bottom-left cell is the one that matters: wrong, but sure.
      </p>
      <div className="mt-4 grid grid-cols-[auto_1fr_1fr] gap-3">
        <div />
        <div className="text-center text-step--1 uppercase tracking-wide text-text-muted">
          Sure
        </div>
        <div className="text-center text-step--1 uppercase tracking-wide text-text-muted">
          Unsure
        </div>

        <div className="flex items-center text-step--1 uppercase tracking-wide text-text-muted">
          Right
        </div>
        <Cell
          n={m.solid}
          title="Solid"
          hint="right, and sure"
          color="var(--state-solid)"
        />
        <Cell
          n={m.underconfident}
          title="Underconfident"
          hint="right, but doubted it"
          color="var(--state-doubt)"
        />

        <div className="flex items-center text-step--1 uppercase tracking-wide text-text-muted">
          Wrong
        </div>
        <Cell
          n={m.blindSpot}
          title="Blind spot"
          hint="wrong, but sure"
          color="var(--danger)"
          emphasise
        />
        <Cell
          n={m.honestGap}
          title="Honest gap"
          hint="wrong, and knew it"
          color="var(--state-untested)"
        />
      </div>
    </section>
  );
}
