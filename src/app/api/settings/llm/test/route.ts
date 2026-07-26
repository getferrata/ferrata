import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import {
  testAnthropic,
  testOllama,
  testOpenAiCompat,
} from "@/lib/llm/keytest";

export const runtime = "nodejs";

const schema = z.object({
  provider: z.enum(["anthropic", "openai", "ollama"]),
  // Optional: test a candidate key before saving. Falls back to the stored or
  // env key so an already-configured provider can be re-verified.
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});

/** POST /api/settings/llm/test: one cheap live call to verify a provider. */
export async function POST(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { provider, model, baseUrl } = parsed.data;
  const candidate = parsed.data.apiKey?.trim();

  if (provider === "ollama") {
    const url =
      baseUrl ??
      getSetting("OLLAMA_BASE_URL") ??
      process.env.OLLAMA_BASE_URL ??
      undefined;
    return NextResponse.json(await testOllama(url));
  }

  if (provider === "anthropic") {
    const key =
      candidate ??
      getSetting("ANTHROPIC_API_KEY") ??
      process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, detail: "no API key to test" });
    }
    return NextResponse.json(
      await testAnthropic(key, model ?? "claude-haiku-4-5-20251001"),
    );
  }

  const key =
    candidate ??
    getSetting("OPENAI_API_KEY") ??
    getSetting("GROQ_API_KEY") ??
    process.env.OPENAI_API_KEY ??
    process.env.GROQ_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, detail: "no API key to test" });
  }
  const groqStyle = key.startsWith("gsk_");
  const url =
    baseUrl ??
    getSetting("OPENAI_BASE_URL") ??
    process.env.OPENAI_BASE_URL ??
    (groqStyle ? "https://api.groq.com/openai/v1" : undefined);
  const fallbackModel = groqStyle ? "llama-3.1-8b-instant" : "gpt-4o-mini";
  return NextResponse.json(
    await testOpenAiCompat(key, model ?? fallbackModel, url),
  );
}
