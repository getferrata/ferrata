import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { buildAttestation } from "@/lib/course/attestation";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Record of assessment" };

const when = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

/**
 * The page an auditor is shown.
 *
 * Deliberately dull, and deliberately not the dashboard. The dashboard argues
 * about what to do next; this states what happened, dates it, quotes the
 * questions as they were asked, and carries a signature anybody can check. It
 * prints on paper without a stylesheet, because that is how it will be filed.
 */
export default async function AttestationPage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const { id, studentId } = await params;
  const user = await requireUser();
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) notFound();
  // A record about a person is not readable by every other student on the
  // course: an examiner sees any, a student sees only their own.
  if (user.role !== "examiner" && user.id !== studentId) notFound();

  const doc = buildAttestation(id, studentId);
  if (!doc) notFound();
  const { body } = doc;
  const share =
    body.conceptCount > 0
      ? Math.round((body.verifiedConcepts / body.conceptCount) * 100)
      : 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-measure px-4 py-8">
        <h1 className="text-step-3">Record of assessment</h1>

        <dl className="mt-6 flex flex-col gap-2 text-step--1">
          <Row label="Person" value={`${body.studentName} (${body.studentEmail})`} />
          <Row label="Course" value={body.courseTitle} />
          <Row label="Mode" value={body.assessmentMode} />
          <Row
            label="Verified"
            value={`${body.verifiedConcepts} of ${body.conceptCount} concepts (${share}%)`}
          />
          {body.firstAnswerAt ? (
            <Row
              label="Between"
              value={`${when(body.firstAnswerAt)} and ${when(body.lastAnswerAt ?? body.firstAnswerAt)}`}
            />
          ) : null}
          <Row label="Issued" value={when(body.issuedAt)} />
        </dl>

        {body.assessmentMode !== "assessed" ? (
          <p className="mt-6 max-w-measure rounded border border-border p-3 text-step--1">
            This course is in practice mode: the answers below were graded by
            the person answering them. That makes this a record of study, not a
            measurement of knowledge, and it should not be read as one.
          </p>
        ) : null}

        {body.timeline.length > 0 ? (
          <>
            <h2 className="mt-8 text-step-1">How it moved</h2>
            <ul className="mt-2 flex flex-col gap-1 text-step--1">
              {body.timeline.map((p) => (
                <li key={`${p.at}-${p.verifiedConcepts}`}>
                  {when(p.at)}: {p.verifiedConcepts} of {body.conceptCount}{" "}
                  concepts verified ({Math.round(p.share * 100)}%)
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h2 className="mt-8 text-step-1">The trail</h2>
        <p className="mt-1 text-step--1 text-text-muted">{body.verifiedRule}</p>
        {body.trail.length === 0 ? (
          <p className="mt-2 text-step--1">No answers count on this course yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-step--1">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Concept</th>
                  <th className="py-1 pr-3">Question as asked</th>
                  <th className="py-1 pr-3">Result</th>
                  <th className="py-1">Graded by</th>
                </tr>
              </thead>
              <tbody>
                {body.trail.map((a, i) => (
                  <tr key={`${a.answeredAt}-${i}`} className="align-top">
                    <td className="py-1 pr-3 font-mono">{when(a.answeredAt)}</td>
                    <td className="py-1 pr-3">{a.conceptTitle}</td>
                    <td className="py-1 pr-3">{a.prompt}</td>
                    <td className="py-1 pr-3">{a.correct ? "correct" : "wrong"}</td>
                    <td className="py-1">{a.gradedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="mt-8 text-step-1">Signature</h2>
        <p className="mt-1 max-w-measure text-step--1 text-text-muted">
          HMAC-SHA256 over this record, by the install that issued it. Fetch the
          same record as JSON from{" "}
          <code>/api/courses/{id}/attestation?studentId={studentId}</code> and
          check it against the install&rsquo;s key: a changed date, mark or
          question makes the signature stop matching.
        </p>
        <p className="mt-2 break-all font-mono text-step--1">{doc.signature}</p>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}
