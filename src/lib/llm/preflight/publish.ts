import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PreflightReport, Verdict } from "./report";

/**
 * The part of a preflight run that can safely leave the machine it ran on.
 *
 * The preflight already produces the shape of a compatibility row: which stages
 * held, what the fixture cost, how many calls were billed and thrown away and
 * why. Today that lives on one operator's settings page, and every operator
 * pays to learn the same thing about the same model.
 *
 * Two rules decide what this is allowed to contain.
 *
 * The fixture is built in, so the stage results and the token counts are about
 * Ferrata and the model. The ledger is not: it is the operator's spending, on
 * their key, in their install. So nothing here is read from a course, a user,
 * or a run other than this one, and the row carries no identifier of any kind.
 *
 * And a published row is a claim about somebody else's model, made by a version
 * of Ferrata with particular prompts and particular ceilings in it. Change a
 * prompt and the same model can score differently. Without the version attached
 * the row stops being a measurement and becomes a rumour, so the version is
 * mandatory rather than a field somebody can leave out.
 */

export interface CompatibilityRow {
  /** The model as the provider names it, e.g. "llama-3.3-70b-versatile". */
  model: string;
  /** Which of the three provider slots it ran through. */
  provider: string;
  /** Ferrata's version, without which the numbers do not mean anything. */
  ferrataVersion: string;
  /** Stages that produced something the schema accepted, over stages attempted. */
  stagesOk: number;
  stagesTotal: number;
  verdict: Verdict;
  /** What the fixture cost end to end, this run. Zero on a local model. */
  totalUsd: number;
  totalCalls: number;
  /** Billed and discarded. The number that separates usable from expensive. */
  wastedCalls: number;
  /**
   * Why calls were discarded, deduplicated and stripped of anything specific.
   * A schema rule rejecting good answers and a ceiling set too low look
   * identical in a count and need opposite fixes.
   */
  reasons: string[];
  /** Stages that never produced a call at all: the worst outcome, named. */
  missing: string[];
}

function version(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

/**
 * A published reason has to describe the shape of the failure, not the run.
 *
 * A validation message quotes the paths the model got wrong, which is exactly
 * what another operator needs. A transport message quotes hostnames, ports and
 * sometimes a key fragment, which is exactly what must not leave the machine.
 * So transport errors are reduced to the fact that they happened.
 */
export function publishableReason(reason: string): string {
  const t = reason.trim();
  if (t.startsWith("schema:")) return t.slice("schema:".length).trim();
  if (t.startsWith("transport:")) return "the call itself failed";
  if (/truncated|token cap/i.test(t)) return t;
  // Anything whose shape is not recognised is summarised rather than passed
  // through: an unrecognised string is the one most likely to carry a detail
  // about this install.
  return "discarded for a reason this version does not classify";
}

export function toCompatibilityRow(
  report: PreflightReport,
  model: string,
  provider: string,
): CompatibilityRow {
  const reasons = [
    ...new Set(
      report.stages.flatMap((s) => s.reasons).map(publishableReason),
    ),
  ];
  return {
    model,
    provider,
    ferrataVersion: version(),
    stagesOk: report.stages.filter((s) => s.ok).length,
    stagesTotal: report.stages.length + report.missing.length,
    verdict: report.verdict,
    totalUsd: report.totalUsd,
    totalCalls: report.totalCalls,
    wastedCalls: report.wastedCalls,
    reasons,
    missing: [...report.missing],
  };
}

/** One line of the table, for a README or a docs page. */
export function toMarkdownRow(row: CompatibilityRow): string {
  const cost = row.totalUsd > 0 ? `$${row.totalUsd.toFixed(4)}` : "free";
  return `| ${row.model} | ${row.provider} | ${row.stagesOk}/${row.stagesTotal} | ${row.verdict} | ${cost} | ${row.wastedCalls} | ${row.ferrataVersion} |`;
}

export const MARKDOWN_HEADER = [
  "| Model | Provider | Stages | Verdict | Fixture cost | Calls discarded | Ferrata |",
  "|---|---|---|---|---|---|---|",
].join("\n");
