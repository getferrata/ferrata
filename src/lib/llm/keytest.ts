/**
 * Live connectivity checks for the settings panel. Self-contained fetches (no
 * provider classes, which read process.env in their constructors) so a
 * candidate key can be tested before it is saved.
 */

export interface KeyTestResult {
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 12_000;

async function timed(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function testAnthropic(
  apiKey: string,
  model: string,
  baseUrl = "https://api.anthropic.com",
): Promise<KeyTestResult> {
  try {
    const res = await timed(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    });
    if (res.ok) return { ok: true, detail: `key works, checked with ${model}` };
    const body = await res.text();
    return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: `unreachable (${String(err).slice(0, 120)})` };
  }
}

export async function testOpenAiCompat(
  apiKey: string,
  model: string,
  baseUrl = "https://api.openai.com/v1",
): Promise<KeyTestResult> {
  try {
    const res = await timed(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: "Reply with OK." }],
        }),
      },
    );
    if (res.ok) return { ok: true, detail: `key works, checked with ${model}` };
    const body = await res.text();
    return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: `unreachable (${String(err).slice(0, 120)})` };
  }
}

export async function testOllama(
  baseUrl = "http://127.0.0.1:11434",
): Promise<KeyTestResult> {
  try {
    const res = await timed(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const n = data.models?.length ?? 0;
    return {
      ok: true,
      detail: n > 0 ? `reachable, ${n} models installed` : "reachable, no models pulled yet",
    };
  } catch (err) {
    return { ok: false, detail: `unreachable (${String(err).slice(0, 120)})` };
  }
}
