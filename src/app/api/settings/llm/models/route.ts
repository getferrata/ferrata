import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import {
  listAnthropicModels,
  listOllamaModels,
  listOpenAiCompatModels,
  mergeModels,
} from "@/lib/llm/modelslist";

export const runtime = "nodejs";

const schema = z.object({
  provider: z.enum(["anthropic", "openai", "ollama"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

/**
 * POST /api/settings/llm/models: list the models this account can use, live
 * from the provider, merged with the curated catalog labels. Falls back to the
 * catalog alone when the provider is unreachable or no key is available.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { provider, baseUrl } = parsed.data;
  const candidate = parsed.data.apiKey?.trim();

  let live: string[] = [];
  let liveOk = false;
  try {
    if (provider === "ollama") {
      const url =
        baseUrl ??
        getSetting("OLLAMA_BASE_URL") ??
        process.env.OLLAMA_BASE_URL ??
        undefined;
      live = await listOllamaModels(url);
      liveOk = true;
    } else if (provider === "anthropic") {
      const key =
        candidate && !candidate.startsWith("…")
          ? candidate
          : (getSetting("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY);
      if (key) {
        live = await listAnthropicModels(key);
        liveOk = true;
      }
    } else {
      const key =
        candidate && !candidate.startsWith("…")
          ? candidate
          : (getSetting("OPENAI_API_KEY") ??
            getSetting("GROQ_API_KEY") ??
            process.env.OPENAI_API_KEY ??
            process.env.GROQ_API_KEY);
      if (key) {
        const url =
          baseUrl ??
          getSetting("OPENAI_BASE_URL") ??
          process.env.OPENAI_BASE_URL ??
          (key.startsWith("gsk_") ? "https://api.groq.com/openai/v1" : undefined);
        live = await listOpenAiCompatModels(key, url);
        liveOk = true;
      }
    }
  } catch {
    // Provider unreachable or key invalid: fall back to the curated catalog.
    live = [];
    liveOk = false;
  }

  return NextResponse.json({
    models: mergeModels(provider, live),
    live: liveOk,
  });
}
