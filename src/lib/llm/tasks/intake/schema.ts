import { z } from "zod";
import { ciEnum } from "@/lib/llm/zod";

/** Rough concept as first surfaced at intake; refined into the DAG downstream. */
export const candidateConceptSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  priority: ciEnum(["critical", "high", "medium", "low"]),
  estimatedMinutes: z.number().int().positive().max(600),
  depthLevel: z.number().int().min(0).max(3),
});

export const intakeSchema = z.object({
  /** Short course title in the input language. */
  title: z.string().min(1),
  /** ISO 639-1 code the course is written in: the material's dominant language if
   *  material was given, otherwise the language the author wrote in. */
  lang: z.string().min(2).max(5),
  /** The honest, reframed objective: not "master X", but what success really is. */
  objective: z.string().min(1),
  domain: z.string().min(1),
  /** The learner's declared/​inferred starting point. */
  startLevel: z.string().min(1),
  /** Natural-language deadline as written, or null. Parsed downstream. */
  deadline: z.string().nullable(),
  /** Study budget in minutes if stated/inferable, else null. */
  budgetMinutes: z.number().int().positive().nullable(),
  /**
   * The per-domain concreteness compact stated to the reader:
   * for infra/business it is "dove sta fisicamente e chi paga"; for other
   * domains its equivalent (worked example, before/after diff, …).
   */
  concretenessRule: z.string().min(1),
  candidateConcepts: z.array(candidateConceptSchema).min(3).max(40),
  /**
   * What the material covered and this course deliberately leaves out. The
   * prompt tells intake to drop what the student already knows and what the
   * deadline does not reach; without this field it dropped it in silence and
   * the student was never told a whole appendix had been skipped.
   */
  outOfScope: z
    .array(
      z.object({
        title: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .max(20)
    .optional(),
});

export type IntakeResult = z.infer<typeof intakeSchema>;
export type CandidateConcept = z.infer<typeof candidateConceptSchema>;
