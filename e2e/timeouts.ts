/**
 * Every wait in this suite, in one place, scaled once.
 *
 * The numbers were picked on the machine they were written on and spread by
 * hand across eight files. On a box four to five times slower, which is an
 * ordinary Windows laptop rather than an unusual one, nine of sixty-three
 * browser tests failed and every one of them failed on a clock: waiting ninety
 * seconds for a pipeline that needed two minutes, thirty for a course creation
 * that took forty. The product was fine. The suite was measuring the machine.
 *
 * A generous timeout is close to free, and that is the argument for this. It
 * costs nothing while a test passes, because a wait ends when the thing it
 * waits for arrives. It costs time only when something is already broken, and
 * a failing run is not the case worth optimising for. A tight timeout, on the
 * other hand, costs a false failure on every slow machine forever, and a
 * suite that fails for reasons that are not defects is a suite people learn to
 * ignore.
 *
 * E2E_TIMEOUT_SCALE moves all of them together for a machine slower still.
 */

const SCALE = Number(process.env.E2E_TIMEOUT_SCALE ?? "") || 4;

/** Seconds, as this machine measures them, in milliseconds. */
export function wait(seconds: number): number {
  return Math.round(seconds * 1000 * SCALE);
}

/** The whole-test ceiling and the default for a single expectation. */
export const TEST_TIMEOUT = wait(90);
export const EXPECT_TIMEOUT = wait(15);
