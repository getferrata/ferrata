import type { DepthPreset } from "@/db/schema";

/**
 * Turn the course's depth preset into guidance injected into the intake and
 * write_module prompts. Two levers: how much the graph EXPANDS (intake adds
 * prerequisite concepts) and how much each module EXPLAINS inline.
 */
export function intakeDepthGuidance(preset: DepthPreset): string {
  switch (preset) {
    case "overview":
      return "DEPTH chosen: Overview. The learner already has the basics. Keep the concept list short and high level, cut decisively, and do NOT add basic prerequisite concepts.";
    case "scratch":
      return "DEPTH chosen: From scratch. The learner starts from almost nothing. ADD the basic prerequisites as concepts of their own (for BGP, include IP addressing, TCP, routing basics). More concepts, more foundations.";
    default:
      return "DEPTH chosen: Operational (default). Standard depth: concrete and operational, without teaching every prerequisite from scratch.";
  }
}

export function moduleDepthGuidance(preset: DepthPreset): string {
  switch (preset) {
    case "overview":
      return "Depth: overview. Keep it tight; you may take the basic terms as known.";
    case "scratch":
      return "Depth: from scratch. Assume little: when you use a basic term the learner may not know (what an IP is, what TCP is), explain it in a sentence or a short aside, one level below this concept.";
    default:
      return "Depth: operational. Explain the concept concretely; assume a general background but not deep expertise.";
  }
}
