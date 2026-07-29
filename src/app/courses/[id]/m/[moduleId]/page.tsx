import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseBundle } from "@/lib/course/query";
import { renderMarkdown } from "@/lib/md";
import { parseGlossaryTerms } from "@/lib/glossary-terms";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { ConceptGraph } from "@/components/concept-graph";
import { ModuleTests } from "@/components/module-tests";
import { toClientQuestion } from "@/lib/review/grade";
import { EditModule } from "@/components/edit-module";
import { RegenerateModule } from "@/components/regenerate-module";
import { ModuleRewriting } from "@/components/module-rewriting";
import { moduleRewriteInFlight } from "@/lib/jobs/queue";
import { MarkPosition } from "@/components/mark-position";
import { FeynmanPanel } from "@/components/feynman-panel";
import { VideoAnnex } from "@/components/video-annex";
import { isVideoEnabled, parseRefs, searchUrl } from "@/lib/video";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}): Promise<Metadata> {
  const { id, moduleId } = await params;
  const bundle = getCourseBundle(id);
  const view = bundle?.modules.find((m) => m.module?.id === moduleId);
  return { title: view ? view.concept.title : "Module" };
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;
  // A course id is guessable, so a session alone is not enough: this has to
  // be a course this person owns or was assigned.
  const viewer = await requireUser();
  if (!canSeeCourse(id, { userId: viewer.id, role: viewer.role })) notFound();
  const bundle = getCourseBundle(id);
  if (!bundle) notFound();

  const idx = bundle.modules.findIndex((m) => m.module?.id === moduleId);
  if (idx === -1) notFound();
  const view = bundle.modules[idx]!;
  if (!view.module?.bodyMd) notFound();

  const prev = bundle.modules[idx - 1];
  const next = bundle.modules[idx + 1];

  // A rewrite (from a proposal approval or the button below) runs in the
  // background and swaps this module in place. Surface it so the reader is not
  // staring at the old body wondering when it changes.
  const rewriting =
    viewer.role === "examiner" && moduleRewriteInFlight(view.concept.id);

  // Prerequisite modules of THIS concept, as quick jump-back links (so a reader
  // who feels shaky can revisit what came before). Only those with a real module.
  const prereqIds = new Set(
    bundle.edges
      .filter((e) => e.to === view.concept.id)
      .map((e) => e.from),
  );
  const prereqs = bundle.modules
    .filter((m) => prereqIds.has(m.concept.id) && m.module)
    .map((m) => ({
      id: m.concept.id,
      title: m.concept.title,
      moduleId: m.module!.id,
    }));

  return (
    <>
      <SiteHeader
        right={
          <Link
            href={`/courses/${id}`}
            className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            The route
          </Link>
        }
      />
      <main className="mx-auto max-w-measure px-6 py-12">
        <MarkPosition courseId={id} moduleId={view.module.id} />
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          Module {String(idx).padStart(2, "0")}
          {view.module.kind !== "concept" ? ` · ${view.module.kind}` : ""}
        </p>
        <h1 className="mt-2 font-serif text-step-3 leading-tight tracking-tight">
          {view.concept.title}
        </h1>

        {prereqs.length > 0 ? (
          <p className="mt-3 text-step--1 text-text-muted">
            Before this:{" "}
            {prereqs.map((pr, i) => (
              <span key={pr.id}>
                {i > 0 ? ", " : ""}
                <Link
                  href={`/courses/${id}/m/${pr.moduleId}`}
                  className="text-accent underline underline-offset-2"
                >
                  {pr.title}
                </Link>
              </span>
            ))}
          </p>
        ) : null}

        {bundle.edges.length > 0 ? (
          <details className="mt-5 rounded border border-border bg-bg-subtle px-4 py-3">
            <summary className="cursor-pointer select-none text-step--1 text-text-muted">
              Where you are on the route · step {idx + 1} of {bundle.modules.length}
            </summary>
            <div className="mt-4">
              <ConceptGraph
                nodes={bundle.modules.map((m) => ({
                  id: m.concept.id,
                  title: m.concept.title,
                }))}
                edges={bundle.edges}
                currentId={view.concept.id}
              />
            </div>
          </details>
        ) : null}

        <ModuleRewriting rewriting={rewriting} />

        <article
          className="reading-prose mt-8"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(view.module.bodyMd, {
              glossary: parseGlossaryTerms(bundle.course.glossaryMd),
              restorations: bundle.restorations,
              sources: bundle.sources.map((s) => s.name),
            }),
          }}
        />

        {!rewriting &&
        viewer.role === "examiner" &&
        (!bundle.course.ownerId || bundle.course.ownerId === viewer.id) ? (
          <div className="mt-6 flex flex-col gap-3">
            <EditModule
              courseId={id}
              moduleId={view.module.id}
              bodyMd={view.module.bodyMd}
              editedAt={view.module.editedAt}
            />
            <RegenerateModule courseId={id} moduleId={view.module.id} />
          </div>
        ) : null}

        {view.questions.length > 0 ? (
          <ModuleTests
            courseId={id}
            moduleTitle={view.concept.title}
            questions={view.questions.map((q) =>
              toClientQuestion(q, bundle.course.assessmentMode === "assessed"),
            )}
          />
        ) : null}

        <FeynmanPanel
          conceptId={view.concept.id}
          conceptTitle={view.concept.title}
        />

        {/* A ref added here is stored on the concept, so it changes the module
            for everyone on the course. Learners read the annex, authors edit it. */}
        {isVideoEnabled() && viewer.role === "examiner" ? (
          <VideoAnnex
            courseId={id}
            conceptId={view.concept.id}
            searchHref={searchUrl(view.concept.title, bundle.course.domain ?? "")}
            initialRefs={parseRefs(view.concept.videoRefsJson)}
          />
        ) : null}

        <nav className="mt-16 flex items-center justify-between border-t border-border pt-6 text-step--1">
          {prev?.module ? (
            <Link
              href={`/courses/${id}/m/${prev.module.id}`}
              className="tap text-text-muted hover:text-text"
            >
              ← {prev.concept.title}
            </Link>
          ) : (
            <span />
          )}
          {next?.module ? (
            <Link
              href={`/courses/${id}/m/${next.module.id}`}
              className="tap text-right text-text-muted hover:text-text"
            >
              {next.concept.title} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </>
  );
}
