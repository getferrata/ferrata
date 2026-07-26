import { describe, expect, it } from "vitest";
import {
  buildPackage,
  ferrataPackageSchema,
  sourceHashOf,
} from "@/lib/package/format";
import { parsePackage, previewPackage } from "@/lib/package/import";
import type { CourseBundle } from "@/lib/course/query";
import type { Concept, Course, Module, Question } from "@/db/schema";

function bundle(): CourseBundle {
  const course = {
    id: "c1",
    title: "Corso di prova",
    sourcePrompt: "materiale",
    authorContextMd: "contesto autore",
    origin: "local",
    lang: "it",
    objective: "obiettivo",
    domain: "dominio",
    concretenessRule: "regola",
    startLevel: "base",
    scheduleMd: "piano",
    glossaryMd: "glossario",
    deadline: null,
    budgetMinutes: 480,
    status: "ready",
    createdAt: 0,
  } as unknown as Course;

  const concept = {
    id: "k1",
    courseId: "c1",
    title: "BGP",
    summary: "rotte",
    priority: "critical",
    estimatedMinutes: 120,
    depthLevel: 2,
    topoOrder: 0,
    videoRefsJson: null,
  } as unknown as Concept;

  const module = {
    id: "m1",
    conceptId: "k1",
    kind: "concept",
    bodyMd: "# BGP\nUna sessione BGP è una connessione TCP.",
    status: "ready",
    evalScore: 1,
    evalReportJson: null,
    generatedAt: 0,
  } as unknown as Module;

  const question = {
    id: "q1",
    conceptId: "k1",
    prompt: "Cosa è una sessione BGP?",
    expectedAnswer: "Una connessione TCP porta 179.",
    bloomLevel: "understand",
    format: "open",
    optionsJson: null,
    misconceptionsJson: null,
  } as unknown as Question;

  return {
    course,
    modules: [{ concept, module, questions: [question] }],
    edges: [],
    cuts: [{ id: "cut1", courseId: "c1", conceptId: "k1", title: "roba", reason: "fuori tempo" }],
    sources: [],
    restorations: [],
  };
}

describe("course package", () => {
  it("builds a package that validates against the schema", () => {
    const pkg = buildPackage(bundle(), { exportedAt: 1000 });
    expect(ferrataPackageSchema.safeParse(pkg).success).toBe(true);
    expect(pkg.manifest.moduleCount).toBe(1);
    expect(pkg.modules[0]!.bodyMd).toContain("sessione BGP");
    expect(pkg.questions).toHaveLength(1);
  });

  it("never carries student state (no reviews field anywhere)", () => {
    const pkg = buildPackage(bundle(), { exportedAt: 1000 });
    expect(JSON.stringify(pkg)).not.toContain("fsrs");
    expect(JSON.stringify(pkg)).not.toContain("review");
  });

  it("previews the metadata a user confirms before import", () => {
    const pkg = buildPackage(bundle(), { exportedAt: 1000, author: "Denis" });
    const preview = previewPackage(pkg);
    expect(preview).toMatchObject({
      title: "Corso di prova",
      author: "Denis",
      lang: "it",
      moduleCount: 1,
      questionCount: 1,
      conceptCount: 1,
    });
  });

  it("rejects malformed / hostile input", () => {
    expect(() => parsePackage({ not: "a package" })).toThrow();
    expect(() => parsePackage(null)).toThrow();
    expect(() =>
      parsePackage({ ...buildPackage(bundle(), { exportedAt: 1 }), manifest: { format: "evil" } }),
    ).toThrow();
  });

  it("hash is stable for the same source", () => {
    expect(sourceHashOf("a", "b")).toBe(sourceHashOf("a", "b"));
    expect(sourceHashOf("a", "b")).not.toBe(sourceHashOf("a", "c"));
  });
});
