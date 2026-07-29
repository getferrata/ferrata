/**
 * The material a preflight runs on.
 *
 * Small enough to cost a fraction of a cent, and specific enough that the
 * stages behave the way they do on real work: there are named things to be
 * concrete about and to cite, so the concreteness pass and the judge have
 * something to hold the module to rather than waving through an abstraction.
 *
 * Deliberately about a subject nobody's course is about, so a preflight can
 * never be mistaken for content and never collides with real material.
 */

export const PREFLIGHT_BRIEF =
  "A new hire joins the team that keeps the office coffee machine running. " +
  "They have never descaled one. They need to handle the Monday morning " +
  "queue without calling anyone.";

export const PREFLIGHT_MATERIAL = [
  "source: runbook.md",
  "",
  "The machine in the kitchen is a Gaggia Classic on a 15 minute warm-up.",
  "The grinder beside it is set to 12 clicks from closed. Anything finer and",
  "the group head chokes: the pump whines and nothing comes out.",
  "",
  "Descaling is due every 400 shots. The counter is under Settings, Service.",
  "Facilities pays for the descaler, the office manager orders it, and the",
  "team complains to whoever made the last cup when it tastes like metal.",
  "",
  "A shot that runs in under 15 seconds means the grind is too coarse.",
].join("\n");

export const PREFLIGHT_CONCEPT = {
  title: "Reading a choked group head",
  summary:
    "The pump whines and nothing comes out: the grind is too fine, not a broken machine.",
  depthLevel: 2,
};

/** The course-level fields the later stages expect, fixed so cost cannot drift. */
export const PREFLIGHT_COURSE = {
  lang: "en",
  objective: "Serve the Monday queue without calling anyone.",
  domain: "office facilities",
  startLevel: "has used a coffee machine, never maintained one",
  concretenessRule:
    "Every abstract point says where it physically sits and who pays.",
} as const;
