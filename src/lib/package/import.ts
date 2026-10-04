import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  cuts as cutsT,
  edges as edgesT,
  modules as modulesT,
  packages as packagesT,
  questions as questionsT,
  figures as figuresT,
  sources as sourcesT,
} from "@/db/schema";
import { newId } from "@/lib/util/id";
import { ferrataPackageSchema, type FerrataPackage } from "./format";

/** Validate untrusted input into a package, or throw a readable error. */
export function parsePackage(raw: unknown): FerrataPackage {
  const parsed = ferrataPackageSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // In the interface's own language, and in words about the file rather than the
    // validator's: "manifest (Required)" says nothing to somebody who picked the
    // wrong file.
    const where = first?.path.join(".");
    const what =
      first === undefined
        ? ""
        : first.message === "Required"
          ? ` (${where} is missing)`
          : ` (${where}: ${first.message.toLowerCase()})`;
    throw new Error(`This is not a valid Ferrata package${what}.`);
  }
  return parsed.data;
}

export interface PackagePreview {
  title: string;
  author: string | null;
  lang: string;
  license: string | null;
  moduleCount: number;
  questionCount: number;
  conceptCount: number;
  exportedAt: number;
}

/** Metadata for the confirm-before-import screen. */
export function previewPackage(pkg: FerrataPackage): PackagePreview {
  return {
    title: pkg.manifest.title,
    author: pkg.manifest.author,
    lang: pkg.manifest.lang,
    license: pkg.manifest.license,
    moduleCount: pkg.modules.length,
    questionCount: pkg.questions.length,
    conceptCount: pkg.graph.concepts.length,
    exportedAt: pkg.manifest.exportedAt,
  };
}

/**
 * Import a validated package as a new course owned by `ownerId`. Marked
 * `origin: imported` and `trusted: false`: the content is untrusted until
 * someone reads it, and carries no student state, since reviews are never in a
 * package. Concept ids are remapped so an import cannot collide with an
 * existing course.
 *
 * The owner is required rather than optional. A course with none is visible to
 * everyone on the install, which is right for the seeded demo and wrong for
 * something an examiner just imported.
 */
export function importPackage(pkg: FerrataPackage, ownerId: string): string {
  const courseId = newId("course");
  const idMap = new Map<string, string>();
  for (const c of pkg.graph.concepts) idMap.set(c.id, newId("concept"));

  db.transaction((tx) => {
    tx.insert(coursesT)
      .values({
        id: courseId,
        ownerId,
        title: pkg.manifest.title,
        sourcePrompt: pkg.context,
        authorContextMd: pkg.context,
        origin: "imported",
        lang: pkg.manifest.lang,
        objective: pkg.objective,
        domain: pkg.domain,
        concretenessRule: pkg.concretenessRule,
        startLevel: pkg.startLevel,
        scheduleMd: pkg.scheduleMd,
        glossaryMd: pkg.glossaryMd,
        budgetMinutes: pkg.budgetMinutes,
        status: "ready",
      })
      .run();

    for (const c of pkg.graph.concepts) {
      tx.insert(conceptsT)
        .values({
          id: idMap.get(c.id)!,
          courseId,
          title: c.title,
          summary: c.summary,
          priority: c.priority,
          estimatedMinutes: c.estimatedMinutes,
          depthLevel: c.depthLevel,
          topoOrder: c.topoOrder,
        })
        .run();
    }

    for (const e of pkg.graph.edges) {
      const from = idMap.get(e.from);
      const to = idMap.get(e.to);
      if (!from || !to) continue; // drop dangling edges from a malformed package
      tx.insert(edgesT)
        .values({ id: newId("edge"), courseId, fromConceptId: from, toConceptId: to })
        .run();
    }

    for (const m of pkg.modules) {
      const conceptId = idMap.get(m.conceptId);
      if (!conceptId) continue;
      tx.insert(modulesT)
        .values({
          id: newId("module"),
          conceptId,
          kind: m.kind,
          bodyMd: m.bodyMd,
          status: "ready",
        })
        .run();
    }

    // Pictures arrive pending, exactly as they do when a document is ingested.
    // The gate on a figure is a person looking at it, and the person who looked
    // at these works somewhere else: a diagram that was fine to show inside the
    // company that wrote it is not automatically fine inside the one that
    // received the package. The tokens in the bodies render as nothing until
    // somebody here says otherwise.
    if (pkg.figures?.length) {
      const sourceId = newId("src");
      tx.insert(sourcesT)
        .values({
          id: sourceId,
          courseId,
          kind: "text",
          name: "pictures from the imported package",
          status: "ok",
        })
        .run();
      pkg.figures.forEach((f, ord) => {
        const data = Buffer.from(f.dataBase64, "base64");
        if (data.length === 0) return;
        tx.insert(figuresT)
          .values({
            id: newId("fig"),
            courseId,
            sourceId,
            sha256: f.sha256,
            mime: f.mime,
            bytes: data.length,
            width: f.width,
            height: f.height,
            altText: f.altText,
            ord,
            status: "pending",
            data,
          })
          .run();
      });
    }

    for (const q of pkg.questions) {
      const conceptId = idMap.get(q.conceptId);
      if (!conceptId) continue;
      tx.insert(questionsT)
        .values({
          id: newId("q"),
          conceptId,
          prompt: q.prompt,
          expectedAnswer: q.expectedAnswer,
          bloomLevel: q.bloomLevel,
          format: q.format,
          optionsJson: q.optionsJson,
          misconceptionsJson: q.misconceptionsJson,
        })
        .run();
    }

    for (const c of pkg.cuts) {
      tx.insert(cutsT)
        .values({
          id: newId("cut"),
          courseId,
          conceptId: "",
          title: c.title,
          reason: c.reason,
        })
        .run();
    }

    tx.insert(packagesT)
      .values({
        id: newId("pkg"),
        courseId,
        manifestJson: JSON.stringify(pkg.manifest),
        sourceHash: pkg.manifest.sourceHash,
        trusted: false, // imported → untrusted until re-verified
      })
      .run();
  });

  return courseId;
}
