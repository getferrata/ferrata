"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ModelOption {
  id: string;
  label: string;
  hint: string;
  tier: "heavy" | "light" | null;
}
interface Config {
  values: Record<string, string | null>;
  active: {
    heavy: { provider: string; model: string };
    light: { provider: string; model: string };
    ready: boolean;
    problem: string | null;
  };
  encryptionEnabled: boolean;
}

type ProviderChoice = "auto" | "anthropic" | "openai" | "ollama";

const PROVIDERS: { id: ProviderChoice; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Automatic (recommended)",
    hint: "Uses the best provider you have configured, with a local fallback.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Best writing quality for courses. Needs an API key.",
  },
  {
    id: "openai",
    label: "OpenAI and compatible (ChatGPT, gateways)",
    hint: "Works with any OpenAI style endpoint. Needs an API key.",
  },
  {
    id: "ollama",
    label: "Local, on this machine",
    hint: "No key and nothing leaves. Needs a capable model and real hardware.",
  },
];

export function LlmSettingsForm() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [liveList, setLiveList] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fetchSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/llm", { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as Config;
      setCfg(data);
      const o = data.values.FERRATA_LLM_OVERRIDE;
      setProvider(
        o === "anthropic" || o === "openai" || o === "ollama" ? o : "auto",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const val = useCallback(
    (key: string): string => draft[key] ?? cfg?.values[key] ?? "",
    [draft, cfg],
  );

  // Refresh the model list from the provider whenever the inputs that affect
  // it settle (provider chosen, key pasted, server URL edited).
  const refreshModels = useCallback(async () => {
    if (provider === "auto" || !cfg) {
      setOptions([]);
      return;
    }
    const seq = ++fetchSeq.current;
    try {
      const body: Record<string, string> = { provider };
      const keyField =
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      const k = draft[keyField];
      if (k && !k.startsWith("…")) body.apiKey = k;
      if (provider === "ollama") {
        const url = val("OLLAMA_BASE_URL");
        if (url) body.baseUrl = url;
      }
      if (provider === "openai") {
        const url = val("OPENAI_BASE_URL");
        if (url) body.baseUrl = url;
      }
      const res = await fetch("/api/settings/llm/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { models: ModelOption[]; live: boolean };
      if (seq === fetchSeq.current) {
        setOptions(data.models);
        setLiveList(data.live);
      }
    } catch {
      if (seq === fetchSeq.current) {
        setOptions([]);
        setLiveList(false);
      }
    }
  }, [provider, cfg, draft, val]);

  useEffect(() => {
    void refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, cfg]);

  if (error) {
    return (
      <p role="alert" className="mt-8 text-danger">
        {error}
      </p>
    );
  }
  if (!cfg) {
    return <p className="mt-8 text-text-muted">Loading&hellip;</p>;
  }

  const set = (key: string, v: string) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setSaved(false);
    setTestResult(null);
  };

  const keyField =
    provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : provider === "openai"
        ? "OPENAI_API_KEY"
        : null;
  const heavyField =
    provider === "anthropic"
      ? "ANTHROPIC_MODEL_HEAVY"
      : provider === "openai"
        ? "OPENAI_MODEL_HEAVY"
        : provider === "ollama"
          ? "OLLAMA_MODEL_HEAVY"
          : null;
  const lightField =
    provider === "anthropic"
      ? "ANTHROPIC_MODEL_LIGHT"
      : provider === "openai"
        ? "OPENAI_MODEL_LIGHT"
        : provider === "ollama"
          ? "OLLAMA_MODEL_LIGHT"
          : null;

  const providerMeta = PROVIDERS.find((p) => p.id === provider)!;

  async function runTest() {
    if (provider === "auto") return;
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, string> = { provider };
      const k = keyField ? draft[keyField] : undefined;
      if (k && !k.startsWith("…")) body.apiKey = k;
      if (provider === "ollama") {
        const url = val("OLLAMA_BASE_URL");
        if (url) body.baseUrl = url;
      }
      if (provider === "openai") {
        const url = val("OPENAI_BASE_URL");
        if (url) body.baseUrl = url;
        const m = val("OPENAI_MODEL_LIGHT");
        if (m) body.model = m;
      }
      if (provider === "anthropic") {
        const m = val("ANTHROPIC_MODEL_LIGHT");
        if (m) body.model = m;
      }
      const res = await fetch("/api/settings/llm/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; detail: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, detail: "test request failed" });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const values: Record<string, string | null> = { ...draft };
      values.FERRATA_LLM_OVERRIDE = provider === "auto" ? null : provider;
      const res = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error();
      setDraft({});
      setSaved(true);
      await load();
    } catch {
      setError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-10 flex flex-col gap-10">
      <div
        className={`rounded border px-4 py-3 text-step--1 text-text-muted ${
          cfg.active.ready
            ? "border-border bg-bg-subtle"
            : "border-accent bg-bg-subtle"
        }`}
      >
        {cfg.active.ready ? (
          <>
            Generation uses{" "}
            <strong className="text-text">
              {cfg.active.heavy.provider} · {cfg.active.heavy.model}
            </strong>{" "}
            for writing and{" "}
            <strong className="text-text">
              {cfg.active.light.provider} · {cfg.active.light.model}
            </strong>{" "}
            for light tasks.
          </>
        ) : (
          <>
            <strong className="text-text">No usable model yet.</strong> A build
            would fall back to{" "}
            <strong className="text-text">
              {cfg.active.heavy.provider} · {cfg.active.heavy.model}
            </strong>
            , but {cfg.active.problem}
          </>
        )}
      </div>

      {cfg.encryptionEnabled ? (
        <p className="text-step--1 text-text-muted">
          Keys are encrypted in the database.
        </p>
      ) : (
        <div className="rounded border border-accent bg-bg-subtle px-4 py-3 text-step--1">
          <strong className="text-text">Keys are stored unencrypted.</strong>{" "}
          <span className="text-text-muted">
            Anyone who gets a copy of the database file, a backup or a volume
            snapshot can read them. Set{" "}
            <code className="font-mono">FERRATA_SECRET_KEY</code> to a long
            random string and restart: keys saved after that are encrypted, and
            existing ones keep working until you save them again.
          </span>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-serif text-step-1">Provider</h2>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderChoice);
            setTestResult(null);
            setSaved(false);
          }}
          className="w-full max-w-md rounded border border-border bg-surface p-3 text-step-0 text-text focus:border-text-muted focus-visible:outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-step--1 text-text-muted">{providerMeta.hint}</p>
      </section>

      {provider !== "auto" ? (
        <section className="flex flex-col gap-5">
          {keyField ? (
            <label className="block">
              <span className="text-step--1 text-text-muted">API key</span>
              <input
                type="password"
                value={val(keyField)}
                onChange={(e) => set(keyField, e.target.value)}
                onBlur={() => void refreshModels()}
                placeholder={cfg.values[keyField] ?? "paste your key"}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
              />
              {cfg.values[keyField] ? (
                <span className="mt-1 block text-step--1 text-text-muted">
                  A key ending in {cfg.values[keyField]} is saved. Leave the
                  field as is to keep it.
                </span>
              ) : null}
            </label>
          ) : null}

          {provider === "ollama" ? (
            <label className="block">
              <span className="text-step--1 text-text-muted">Server URL</span>
              <input
                type="text"
                value={val("OLLAMA_BASE_URL")}
                onChange={(e) => set("OLLAMA_BASE_URL", e.target.value)}
                onBlur={() => void refreshModels()}
                placeholder="http://127.0.0.1:11434"
                spellCheck={false}
                className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
              />
            </label>
          ) : null}

          {heavyField ? (
            <ModelSelect
              label="Writing model (modules and tests)"
              preferTier="heavy"
              options={options}
              value={val(heavyField)}
              onChange={(v) => set(heavyField, v)}
            />
          ) : null}
          {lightField ? (
            <ModelSelect
              label="Light model (structuring and glossary)"
              preferTier="light"
              options={options}
              value={val(lightField)}
              onChange={(v) => set(lightField, v)}
            />
          ) : null}
          {liveList ? (
            <p className="text-step--1 text-text-muted">
              Model list loaded live from your account, so new releases show up
              here as soon as the provider ships them.
            </p>
          ) : null}

          <details className="rounded border border-border bg-bg-subtle px-4 py-3">
            <summary className="cursor-pointer select-none text-step--1 text-text-muted">
              Advanced
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              {provider === "openai" ? (
                <label className="block">
                  <span className="text-step--1 text-text-muted">
                    Base URL (gateways and compatible endpoints)
                  </span>
                  <input
                    type="text"
                    value={val("OPENAI_BASE_URL")}
                    onChange={(e) => set("OPENAI_BASE_URL", e.target.value)}
                    onBlur={() => void refreshModels()}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                    className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
                  />
                </label>
              ) : null}
              {heavyField ? (
                <CustomModelInput
                  label="Custom writing model id"
                  value={val(heavyField)}
                  known={options}
                  onChange={(v) => set(heavyField, v)}
                />
              ) : null}
              {lightField ? (
                <CustomModelInput
                  label="Custom light model id"
                  value={val(lightField)}
                  known={options}
                  onChange={(v) => set(lightField, v)}
                />
              ) : null}
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="min-h-[44px] rounded border border-border bg-surface px-5 text-step-0 text-text transition hover:border-text-muted disabled:opacity-60"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult ? (
              <span
                className={
                  "text-step--1 " +
                  (testResult.ok ? "text-state-solid" : "text-danger")
                }
              >
                {testResult.ok ? "✓ " : "✗ "}
                {testResult.detail}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex items-center gap-4 border-t border-border pt-6">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-[44px] rounded bg-accent px-6 text-step-0 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved ? (
          <span className="text-step--1 text-state-solid">
            Saved. New generations use this configuration.
          </span>
        ) : null}
      </div>

      {/* Contextia: always-on protection, in its own brand */}
      <aside className="rounded-lg border border-border bg-surface p-5">
        <p className="font-mono text-step-0 font-semibold text-[#ff5f57]">
          Contextia
        </p>
        <p className="mt-2 max-w-measure text-step--1 text-text-muted">
          Whatever provider you pick, your material passes through Contextia
          first: an open, free data protection layer that strips secrets
          (keys, tokens, passwords) before any model sees them, and shields
          internal addresses and hostnames, restoring them into the finished
          course. It is on by default and you can raise the protection level
          for each course when you create it.
        </p>
        <p className="mt-3 text-step--1">
          <a
            href="https://contextia.dev"
            target="_blank"
            rel="noopener"
            className="tap text-[#ff5f57] underline underline-offset-2"
          >
            How Contextia works
          </a>
        </p>
      </aside>
    </div>
  );
}

function ModelSelect({
  label,
  preferTier,
  options,
  value,
  onChange,
}: {
  label: string;
  preferTier: "heavy" | "light";
  options: ModelOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Preferred tier first, then the rest; stable within each group.
  const sorted = [...options].sort((a, b) => {
    const at = a.tier === preferTier ? 0 : a.tier === null ? 1 : 2;
    const bt = b.tier === preferTier ? 0 : b.tier === null ? 1 : 2;
    return at - bt;
  });
  const inList = sorted.some((o) => o.id === value);

  return (
    <label className="block">
      <span className="text-step--1 text-text-muted">{label}</span>
      <select
        value={inList ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full max-w-md rounded border border-border bg-surface p-3 text-step-0 text-text focus:border-text-muted focus-visible:outline-none"
      >
        <option value="">Let Ferrata choose</option>
        {sorted.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.hint ? ` · ${o.hint}` : ""}
          </option>
        ))}
      </select>
      {!inList && value ? (
        <span className="mt-1 block font-mono text-step--1 text-text-muted">
          current: {value} (set under Advanced)
        </span>
      ) : null}
    </label>
  );
}

function CustomModelInput({
  label,
  value,
  known,
  onChange,
}: {
  label: string;
  value: string;
  known: ModelOption[];
  onChange: (v: string) => void;
}) {
  const isCustom = value !== "" && !known.some((o) => o.id === value);
  return (
    <label className="block">
      <span className="text-step--1 text-text-muted">{label}</span>
      <input
        type="text"
        value={isCustom ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="exact model id, for a model not in the list"
        spellCheck={false}
        className="mt-1 w-full rounded border border-border bg-surface p-3 font-mono text-step--1 text-text focus:border-text-muted focus-visible:outline-none"
      />
    </label>
  );
}
