import { getSetting } from "@/lib/settings";
import { listOllamaModels } from "./modelslist";
import type { ProviderName } from "./registry";

/**
 * Whether the provider a task would use is actually usable right now.
 *
 * Resolution always lands somewhere: with no key configured it falls back to a
 * local Ollama, which is assumed reachable because nothing can prove otherwise
 * without a network call. The settings banner reported that plan as if it were
 * a working setup, so an install with no keys and no Ollama read as ready and
 * then failed on the first call of a paid-looking build.
 */
export type ProviderHealth =
  | { ok: true }
  | { ok: false; reason: string };

function key(name: string): string | undefined {
  return getSetting(name) ?? process.env[name] ?? undefined;
}

export async function providerHealth(
  provider: ProviderName,
  model: string,
): Promise<ProviderHealth> {
  if (provider === "anthropic") {
    return key("ANTHROPIC_API_KEY")
      ? { ok: true }
      : { ok: false, reason: "no Anthropic key is set." };
  }
  if (provider === "openai") {
    return key("OPENAI_API_KEY") || key("GROQ_API_KEY")
      ? { ok: true }
      : { ok: false, reason: "no OpenAI or Groq key is set." };
  }

  const baseUrl = key("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434";
  let installed: string[];
  try {
    installed = await listOllamaModels(baseUrl);
  } catch {
    return {
      ok: false,
      reason: `nothing answers at ${baseUrl}. Add a provider key above, or start Ollama.`,
    };
  }
  // Ollama reports "name:tag"; a bare name in config means the default tag.
  const has = installed.some(
    (m) => m === model || m.split(":")[0] === model.split(":")[0],
  );
  return has
    ? { ok: true }
    : {
        ok: false,
        reason: `Ollama is running but ${model} is not pulled. Run: ollama pull ${model}`,
      };
}
