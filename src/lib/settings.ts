import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { clearProviderCache } from "@/lib/llm/registry";
import { openSecret, sealSecret } from "@/lib/crypto/secrets";

/**
 * LLM configuration stored in the local DB (app_settings) and applied over the
 * process env at boot and on save. DB wins over .env so the in-app panel is the
 * source of truth once used; env remains the fallback for headless installs.
 */
export const LLM_SETTING_KEYS = [
  "FERRATA_LLM_OVERRIDE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL_HEAVY",
  "ANTHROPIC_MODEL_LIGHT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL_HEAVY",
  "OPENAI_MODEL_LIGHT",
  "GROQ_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL_HEAVY",
  "OLLAMA_MODEL_LIGHT",
] as const;

export type LlmSettingKey = (typeof LLM_SETTING_KEYS)[number];

// Which stored settings are worth encrypting. Model names and base URLs are
// configuration; these are credentials.
const SECRET_KEYS = new Set<string>([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
]);

export function isSecretSetting(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function isLlmSettingKey(k: string): k is LlmSettingKey {
  return (LLM_SETTING_KEYS as readonly string[]).includes(k);
}

export function getSetting(key: string): string | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  if (!row) return null;
  return isSecretSetting(key) ? openSecret(row.value) : row.value;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null || value.trim() === "") {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  const stored = isSecretSetting(key) ? sealSecret(value.trim()) : value.trim();
  db.insert(appSettings)
    .values({ key, value: stored, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: stored, updatedAt: Date.now() },
    })
    .run();
}

/** Read every stored LLM setting. Keys with no row are absent from the map. */
export function readLlmSettings(): Partial<Record<LlmSettingKey, string>> {
  const rows = db.select().from(appSettings).all();
  const out: Partial<Record<LlmSettingKey, string>> = {};
  for (const r of rows) {
    if (!isLlmSettingKey(r.key)) continue;
    out[r.key] = isSecretSetting(r.key) ? openSecret(r.value) : r.value;
  }
  return out;
}

// Env values we shadowed with a DB setting, so a later delete restores the
// real environment instead of leaving our stale copy behind.
const shadowed = new Map<string, string | undefined>();

/**
 * Apply stored settings over process.env and drop cached provider instances so
 * the next LLM call picks them up. DB wins; deleting a row falls back to
 * whatever the real environment had (including unset).
 */
export function applyLlmSettings(): void {
  const stored = readLlmSettings();
  for (const key of LLM_SETTING_KEYS) {
    const v = stored[key];
    if (v) {
      if (!shadowed.has(key)) shadowed.set(key, process.env[key]);
      process.env[key] = v;
    } else if (shadowed.has(key)) {
      const original = shadowed.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
      shadowed.delete(key);
    }
  }
  clearProviderCache();
}

/** Mask a secret for display: keep the last 4 chars only. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return `…${tail}`;
}
