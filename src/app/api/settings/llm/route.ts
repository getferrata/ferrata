import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { encryptionEnabled } from "@/lib/crypto/secrets";
import {
  LLM_SETTING_KEYS,
  applyLlmSettings,
  isLlmSettingKey,
  maskSecret,
  readLlmSettings,
  setSetting,
} from "@/lib/settings";
import { planTask } from "@/lib/llm/registry";
import { providerHealth } from "@/lib/llm/health";

export const runtime = "nodejs";

const SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
]);

/** GET /api/settings/llm: current config (secrets masked) + model catalog. */
export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }

  const stored = readLlmSettings();
  const values: Record<string, string | null> = {};
  for (const key of LLM_SETTING_KEYS) {
    const v = stored[key] ?? process.env[key] ?? null;
    values[key] = SECRET_KEYS.has(key) ? maskSecret(v) : v;
  }

  // What generation would actually use right now, for the "active" banner.
  const heavy = planTask("write_module");
  const light = planTask("triage");
  // …and whether that plan would survive contact with a first call. Resolution
  // always lands somewhere, so the plan alone says nothing about readiness.
  const health = await providerHealth(heavy.providerName, heavy.model);

  return NextResponse.json({
    values,
    // So an operator can see the state of their own install rather than
    // assuming keys are protected because the product mentions encryption.
    encryptionEnabled: encryptionEnabled(),
    active: {
      heavy: { provider: heavy.providerName, model: heavy.model },
      light: { provider: light.providerName, model: light.model },
      ready: health.ok,
      problem: health.ok ? null : health.reason,
    },
  });
}

const postSchema = z.object({
  values: z.record(z.string(), z.string().nullable()),
});

/**
 * POST /api/settings/llm: save settings (allowlisted keys only) and apply them
 * immediately. Secrets are stored in the local DB, never echoed back.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const entries = Object.entries(parsed.data.values);
  const rejected = entries.filter(([k]) => !isLlmSettingKey(k)).map(([k]) => k);
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: `unknown settings: ${rejected.join(", ")}` },
      { status: 400 },
    );
  }

  for (const [key, value] of entries) {
    // A masked placeholder means "unchanged": ignore it so the form can post
    // its full state without re-entering secrets.
    if (value && value.startsWith("…")) continue;
    setSetting(key, value);
  }
  applyLlmSettings();

  return NextResponse.json({ ok: true });
}
