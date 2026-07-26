/**
 * Next.js instrumentation hook: runs once when the server starts. We boot the
 * in-process job worker here (Node runtime only, never the edge runtime).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Stored LLM settings win over .env, so the in-app panel takes effect on
    // restart as well as on save.
    const { applyLlmSettings } = await import("@/lib/settings");
    applyLlmSettings();
    const { startWorker } = await import("@/lib/jobs/worker");
    startWorker();
  }
}
