import { runPreflight, preflightTag } from "@/lib/llm/preflight";
import {
  MARKDOWN_HEADER,
  toCompatibilityRow,
  toMarkdownRow,
} from "@/lib/llm/preflight/publish";
import { planTask } from "@/lib/llm/registry";
import { newId } from "@/lib/util/id";
import { loadLocalEnv } from "@/lib/env";

/**
 * Run the preflight from the command line and print the row it earns.
 *
 * The same eight calls the settings page makes, without the app: the table in
 * the README is supposed to be measured rather than remembered, and a row
 * somebody typed from memory is the thing that table exists to replace.
 *
 *   OLLAMA_MODEL_HEAVY=qwen2.5:7b FERRATA_DB_PATH=/tmp/pf.db pnpm preflight:row
 *
 * It writes ledger rows, so point FERRATA_DB_PATH somewhere disposable unless
 * the run is meant to count as this install's spending.
 */

async function main(): Promise<void> {
  loadLocalEnv();
  const plan = planTask("write_module");
  process.stdout.write(
    `running the preflight on ${plan.providerName} / ${plan.model}\n`,
  );
  const report = await runPreflight(preflightTag(newId("pf")));
  const row = toCompatibilityRow(report, plan.model, plan.providerName);

  process.stdout.write(`\n${MARKDOWN_HEADER}\n${toMarkdownRow(row)}\n`);
  if (row.reasons.length > 0) {
    process.stdout.write(`\nwhy calls were discarded:\n`);
    for (const r of row.reasons) process.stdout.write(`  - ${r}\n`);
  }
  if (row.missing.length > 0) {
    process.stdout.write(`\nstages that produced nothing: ${row.missing.join(", ")}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
