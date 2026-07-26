import catalog from "./models.json";

/**
 * Live model listing per provider, so the picker shows what the account can
 * actually use today instead of a stale hardcoded list. Curated catalog labels
 * are merged over the raw ids; unknown ids get a prettified label.
 */

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
  tier: "heavy" | "light" | null;
}

const TIMEOUT_MS = 10_000;

async function timed(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function curated(providerId: string): Map<string, ModelOption> {
  const p = catalog.providers.find((x) => x.id === providerId);
  const map = new Map<string, ModelOption>();
  for (const m of p?.models ?? []) {
    map.set(m.id, {
      id: m.id,
      label: m.label,
      hint: m.hint,
      tier: (m.tier as "heavy" | "light") ?? null,
    });
  }
  return map;
}

/** "claude-sonnet-5" -> "Claude Sonnet 5"; "qwen2.5:7b" -> "Qwen2.5 7b". */
export function prettifyModelId(id: string): string {
  return id
    .replace(/[:_-]+/g, " ")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .trim();
}

/** Merge live ids with curated metadata, curated entries first. */
export function mergeModels(
  providerId: string,
  liveIds: string[],
): ModelOption[] {
  const known = curated(providerId);
  const out: ModelOption[] = [];
  const seen = new Set<string>();
  // Curated models that the account actually has (or all curated when the
  // provider does not expose a listing).
  for (const [id, opt] of known) {
    if (liveIds.length === 0 || liveIds.includes(id)) {
      out.push(opt);
      seen.add(id);
    }
  }
  for (const id of liveIds) {
    if (!seen.has(id)) {
      out.push({ id, label: prettifyModelId(id), hint: "", tier: null });
    }
  }
  return out;
}

export async function listAnthropicModels(
  apiKey: string,
  baseUrl = "https://api.anthropic.com",
): Promise<string[]> {
  const res = await timed(`${baseUrl.replace(/\/$/, "")}/v1/models?limit=100`, {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

export async function listOpenAiCompatModels(
  apiKey: string,
  baseUrl = "https://api.openai.com/v1",
): Promise<string[]> {
  const res = await timed(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

export async function listOllamaModels(
  baseUrl = "http://127.0.0.1:11434",
): Promise<string[]> {
  const res = await timed(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}
