import { courseSpend, formatDuration, formatUsd } from "@/lib/llm/spend";

/**
 * What building this course actually cost and how long it took.
 *
 * The estimate before building is a guess, and on the first real run it came
 * out about three times under. A receipt afterwards is what makes the claim
 * checkable: an author can compare it with their provider's dashboard instead
 * of taking the number on trust.
 */
export function CourseReceipt({
  courseId,
  moduleCount,
}: {
  courseId: string;
  moduleCount: number;
}) {
  const spend = courseSpend(courseId);
  if (!spend) return null;

  const perModule = moduleCount > 0 ? spend.usd / moduleCount : 0;

  return (
    <details className="mt-4 rounded border border-border p-4 [&[open]_.marker]:rotate-90">
      <summary className="flex cursor-pointer items-center gap-2 text-step--1 uppercase tracking-wide text-text-muted marker:content-['']">
        <span className="marker font-mono transition-transform">&rsaquo;</span>
        What it cost
      </summary>
      <dl className="mt-3 flex flex-col gap-2 text-step--1">
        <Row label="Spent" value={formatUsd(spend.usd)} />
        <Row label="Took" value={formatDuration(spend.elapsedMs)} />
        {moduleCount > 0 ? (
          <Row label="Per module" value={formatUsd(perModule)} />
        ) : null}
        <Row
          label="Model calls"
          value={
            spend.failedCalls > 0
              ? `${spend.calls} · ${spend.failedCalls} retried`
              : String(spend.calls)
          }
        />
        <Row
          label="Tokens"
          value={`${fmt(spend.tokensIn)} in · ${fmt(spend.tokensOut)} out`}
        />
      </dl>
      <p className="mt-3 max-w-measure text-step--1 text-text-muted">
        Charged by your provider, on your own key. Ferrata takes nothing. This
        is the whole build, retries included, so it should match your provider
        dashboard for the same period.
      </p>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-mono text-text">{value}</dd>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
