import {
  detectDetailed,
  detectors,
  type Finding,
} from "@sbr0nch/contextia-engine";
import { createHash } from "node:crypto";

/**
 * DLP gate, backed by Contextia (on-device secret/PII detection). Source text
 * passes through here BEFORE it is chunked, stored, or sent to a model.
 *
 * Two outcomes per finding:
 *  - CRITICAL secrets + PII (keys, tokens, cards, SSN, emails…): redacted
 *    irreversibly to ⟨redacted:type⟩. They never reach the model and never come back.
 *  - RESTORABLE operational values (private IPs, internal hostnames): replaced
 *    with a stable placeholder token ⟨cxt:hash⟩ that the model sees instead of the
 *    real value, but we keep a restore map so Ferrata can put the real value
 *    back into the finished course (marked as Contextia-protected). This is what
 *    a sysadmin onboarding needs: the model never sees the IP, the student does.
 *
 * The matched secret value is NEVER stored for critical findings; only restorable
 * operational values are kept (they are the operator's own infra data, local).
 */

// Operational infra values a course legitimately needs, safe to restore.
const RESTORABLE = new Set(["private_ip", "internal_hostname"]);

/**
 * Operator control (env, read per-call so a restart isn't needed to re-read):
 *   CONTEXTIA_MODE = redact (default) | off | block: the operator FLOOR.
 *     - off:    protection is allowed to be disabled; text can pass untouched.
 *     - redact: scan; secrets → ⟨redacted⟩, infra values → protected+restored.
 *     - block:  like redact, but a source with CRITICAL secrets is refused (not
 *               grounded on), forcing the operator to clean the file first.
 *   CONTEXTIA_ALLOW = comma-separated exact values to ignore (false positives).
 *
 * Protection ordering: off < redact < block. The env sets the FLOOR (minimum
 * protection). A per-course choice can only RAISE protection above the floor,
 * never lower it, so an author cannot silently ship secrets to a model by
 * picking "off" unless the operator has explicitly lowered the floor to off.
 * Default floor is redact: safe for a hosted, multi-user beta.
 */
export type ContextiaMode = "redact" | "off" | "block";

const MODE_RANK: Record<ContextiaMode, number> = { off: 0, redact: 1, block: 2 };

/** The operator's floor from env (default redact). */
function envFloor(): ContextiaMode {
  const m = (process.env.CONTEXTIA_MODE ?? "redact").trim().toLowerCase();
  return m === "off" || m === "block" ? m : "redact";
}

/** The effective mode: the more restrictive of the operator floor and the choice. */
export function resolveMode(explicit?: ContextiaMode): ContextiaMode {
  const floor = envFloor();
  if (!explicit) return floor;
  return MODE_RANK[explicit] >= MODE_RANK[floor] ? explicit : floor;
}
function allowValues(): string[] {
  return (process.env.CONTEXTIA_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The default detectors PLUS the restorable ones (which ship default-disabled):
// we want to catch IPs/hostnames precisely so we can protect *and* restore them.
const ENABLED_DETECTORS = [
  ...new Set([
    ...detectors.filter((d) => d.defaultEnabled).map((d) => d.id),
    ...RESTORABLE,
  ]),
];

export interface Restoration {
  token: string;
  value: string;
  label: string;
  type: string;
}

export interface SensitivityFinding {
  type: string;
  label: string;
  severity: "critical" | "warning";
  rationale: string;
  count: number;
}

export interface SensitivityVerdict {
  level: "public" | "internal" | "restricted";
  redactions: number; // truly removed (never restored)
  protectedValues: number; // restorable, put back into the course
  findings: SensitivityFinding[];
  note?: string;
}

export interface ScanResult {
  /** Text safe to store/ground on: secrets redacted, infra values tokenized. */
  text: string;
  verdict: SensitivityVerdict | null;
  /** Restore map for the tokenized operational values (empty if none). */
  restorations: Restoration[];
  /** block mode: the source has critical secrets and must not be ingested. */
  blocked: boolean;
}

function tokenFor(value: string): string {
  const h = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `⟨cxt:${h}⟩`; // ⟨cxt:hash⟩
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1 };

/**
 * Collapse overlapping findings into clusters spanning the union of their
 * offsets, labelled by the highest-severity then longest member.
 *
 * Selecting one winner and skipping the rest leaves the tail of the loser in
 * clear: a warning at [0,20] overlapping a critical at [15,60] would drop the
 * critical entirely and pass [20,60] through untouched. Covering the union is
 * the only choice that cannot leak part of a secret.
 *
 * No detector pair in the engine currently produces that shape, so this is not
 * a leak being closed. It is the assumption removed: the engine's own redactor
 * stopped relying on it, and detectors are appended to over time.
 */
export function clusterOverlaps(findings: Finding[]): Finding[] {
  const ordered = [...findings].sort(
    (a, b) =>
      a.start - b.start ||
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      b.end - a.end,
  );
  const out: Finding[] = [];
  for (const f of ordered) {
    const last = out[out.length - 1];
    if (!last || f.start >= last.end) {
      out.push({ ...f });
      continue;
    }
    // Overlap: widen the cluster, and let the more serious finding name it.
    const better =
      (SEVERITY_RANK[f.severity] ?? 9) !== (SEVERITY_RANK[last.severity] ?? 9)
        ? (SEVERITY_RANK[f.severity] ?? 9) < (SEVERITY_RANK[last.severity] ?? 9)
          ? f
          : last
        : f.end - f.start > last.end - last.start
          ? f
          : last;
    out[out.length - 1] = {
      ...better,
      start: last.start,
      end: Math.max(last.end, f.end),
    };
  }
  return out;
}

export async function scanSensitivity(
  text: string,
  _name: string,
  explicitMode?: ContextiaMode,
): Promise<ScanResult> {
  const m = resolveMode(explicitMode);
  // Disabled: pass through untouched (operator opted out).
  if (m === "off") {
    return { text, verdict: null, restorations: [], blocked: false };
  }

  // detectDetailed, not detect: the engine caps how much it reads, and on a
  // long file an empty result means "nothing in the part we read", not "clean".
  // Treating that as clean would send the unscanned tail straight to the model.
  const { findings, truncated, scannedLength } = detectDetailed(text, {
    enabledDetectors: ENABLED_DETECTORS,
    allowlist: { values: allowValues() },
  });
  if (truncated) {
    return {
      text,
      verdict: {
        level: "restricted",
        redactions: 0,
        protectedValues: 0,
        findings: [
          {
            type: "unscanned_tail",
            label: "Too long to scan in full",
            severity: "critical",
            rationale: `Only the first ${scannedLength.toLocaleString()} characters could be scanned. The rest was not checked, so this file is refused rather than passed on unread. Split it and upload the parts.`,
            count: 1,
          },
        ],
      },
      restorations: [],
      // Fail closed regardless of mode: an unread tail is unknown, not clean.
      blocked: true,
    };
  }
  if (findings.length === 0) {
    return {
      text,
      verdict: { level: "public", redactions: 0, protectedValues: 0, findings: [] },
      restorations: [],
      blocked: false,
    };
  }

  const kept = clusterOverlaps(findings);
  const restorations: Restoration[] = [];
  const seenToken = new Set<string>();
  const byType = new Map<string, SensitivityFinding>();
  let out = "";
  let cursor = 0;
  let redactions = 0;

  for (const f of kept) {
    out += text.slice(cursor, f.start);
    // The span, not the representative's own match: a cluster covers the union
    // of overlapping findings, so its span can be wider than any one match.
    const matched = text.slice(f.start, f.end);
    if (RESTORABLE.has(f.type)) {
      const token = tokenFor(matched);
      out += token;
      if (!seenToken.has(token)) {
        seenToken.add(token);
        restorations.push({
          token,
          value: matched,
          label: f.label,
          type: f.type,
        });
      }
    } else {
      out += `⟨redacted:${f.type}⟩`;
      redactions += 1;
      const prev = byType.get(f.type);
      if (prev) prev.count += 1;
      else
        byType.set(f.type, {
          type: f.type,
          label: f.label,
          severity: f.severity,
          rationale: f.rationale,
          count: 1,
        });
    }
    cursor = f.end;
  }
  out += text.slice(cursor);

  const list = [...byType.values()].sort((a, b) =>
    a.severity === b.severity
      ? b.count - a.count
      : a.severity === "critical"
        ? -1
        : 1,
  );
  const hasCritical = list.some((f) => f.severity === "critical");
  const level = hasCritical
    ? "restricted"
    : redactions > 0 || restorations.length > 0
      ? "internal"
      : "public";

  return {
    text: out,
    verdict: {
      level,
      redactions,
      protectedValues: restorations.length,
      findings: list,
    },
    restorations,
    blocked: m === "block" && hasCritical,
  };
}
