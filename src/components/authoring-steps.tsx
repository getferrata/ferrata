/**
 * The authoring journey, made visible. Creating a course is the critical part
 * (it's where the author's context is extracted), so it must read as one guided
 * path, not a form that vanishes into a spinner. These five phases span /crea
 * (step 1) through the live pipeline on the course page (steps 2 to 5). The dots on
 * a line echo the brand: anchors along the cable.
 */

export const AUTHORING_STEPS = [
  "Material",
  "Questions",
  "Plan",
  "Build",
  "Ready",
] as const;

/** Map a course status to its authoring step (1-based). /crea passes 1 directly. */
export function stepForStatus(status: string): number {
  switch (status) {
    case "interviewing":
    case "interview":
      return 2;
    case "intake":
    case "concept_review":
      return 3;
    case "graphing":
    case "triaging":
    case "generating":
    case "finishing":
      return 4;
    case "ready":
      return 5;
    default:
      return 2;
  }
}

export function AuthoringSteps({
  current,
  failed = false,
}: {
  current: number;
  failed?: boolean;
}) {
  const total = AUTHORING_STEPS.length;
  return (
    <nav aria-label="Course creation steps" className="w-full">
      <ol className="flex items-start">
        {AUTHORING_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const isFailedStep = failed && active;
          return (
            <li key={label} className="contents">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-current={active ? "step" : undefined}
                  className={
                    "grid h-7 w-7 place-items-center rounded-full border-2 font-mono text-step--1 " +
                    (isFailedStep
                      ? "border-danger text-danger"
                      : done
                        ? "border-state-solid bg-state-solid text-accent-contrast"
                        : active
                          ? "border-accent text-accent"
                          : "border-border text-text-muted")
                  }
                >
                  {done ? "✓" : isFailedStep ? "!" : n}
                </span>
                <span
                  className={
                    "hidden whitespace-nowrap text-step--1 sm:block " +
                    (active ? "text-text" : "text-text-muted")
                  }
                >
                  {label}
                </span>
              </div>
              {n < total ? (
                <span
                  aria-hidden
                  className={
                    "mx-1.5 mt-3.5 h-0.5 flex-1 rounded " +
                    (done ? "bg-state-solid" : "bg-border")
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-step--1 text-text-muted sm:hidden">
        Step {current} of {total}: {AUTHORING_STEPS[current - 1]}
      </p>
    </nav>
  );
}
