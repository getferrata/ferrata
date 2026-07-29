/**
 * The output token ceiling for each stage.
 *
 * These are a cost lever, not a safety limit, and they work backwards from how
 * they are usually read. A stage that reaches its ceiling does not simply
 * produce a shorter answer: json-repair closes the truncated object so the
 * schema still passes, `runStructuredTask` sees `truncated` and spends a whole
 * second call, and that call carries the first one's output back as context. A
 * ceiling set level with the real output therefore costs roughly double, and on
 * the last attempt the salvaged truncated answer is kept anyway.
 *
 * The first hosted-model run made that concrete. Of the tokens billed, 56 per
 * cent went on calls that were thrown away, all of them from four stages whose
 * ceiling sat exactly on their output:
 *
 *   stage               ceiling   longest output   calls kept / made
 *   concreteness_pass      8000             8000                7 / 17
 *   eval_judge             2000             2000                6 / 20
 *   write_questions        3500             3500                5 / 14
 *   intake                 4096             4096                1 / 9
 *   write_module           8000             6480                8 / 8
 *
 * write_module was the only stage with room, and it is the only one that cost
 * what it should. So the rule these numbers imply: leave real headroom above
 * the longest answer a stage can legitimately produce. Unused headroom is free,
 * because a call is billed on the tokens it emits, not on what it was allowed
 * to emit.
 */
export const OUTPUT_CAPS = {
  /** Reads the brief and the material inventory, and proposes the concepts. */
  intake: 8_000,
  /** A handful of short questions for the author. */
  interview_questions: 3_000,
  /** Edge list over the concepts: short, but grows with the square of them. */
  build_graph: 6_000,
  /**
   * One module body in markdown. The longest single answer in the pipeline, and
   * the only stage that came through the first run without a wasted call, on
   * 6480 tokens against 8000. That is thinner than it looks: one long module
   * would have put it in the same place as the others.
   */
  write_module: 10_000,
  /** Re-emits the whole module body plus its notes, so it needs the most room. */
  concreteness_pass: 16_000,
  /** A verdict that quotes the passages it objects to, not a bare score. */
  eval_judge: 4_000,
  /** Six to eight questions with expected answers and misconceptions. */
  write_questions: 8_000,
  /**
   * A study plan across every module of the course.
   *
   * These two were the stages nobody had measured, because they run after the
   * last module and no course had got that far. The first one that did settled
   * it: on fourteen modules the plan came to 990 tokens and the glossary to
   * 967, one call each, nothing discarded, under ceilings of 1800 and 2500.
   * They were the healthiest stages in the pipeline, not the risk they looked
   * like. The headroom below is kept anyway, because a course three times the
   * size is the case nobody has measured now, and headroom is free.
   */
  schedule: 8_000,
  /** One entry per term across the whole course. Measured at 967, see schedule. */
  glossary: 10_000,
  /** Proposed changes after new material lands on a finished course. */
  propose_updates: 6_000,
  /** A grade and a short explanation of one learner answer. */
  feynman: 1_500,
} as const;

export type TaskWithCap = keyof typeof OUTPUT_CAPS;
