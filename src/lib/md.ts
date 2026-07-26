import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { GlossaryTerm } from "@/lib/glossary-terms";

/**
 * Markdown → sanitized HTML for module bodies and course-level artifacts.
 *
 * Self-generated content is safe, but the same renderer shows **imported**
 * course packages, which are untrusted. So we
 * always sanitize: an allowlist of the tags markdown actually emits, no raw
 * HTML, no scripts, no `on*` handlers, no `javascript:` URLs. Video embeds are a
 * separate React component, not markdown, so they are unaffected.
 */
const marked = new Marked({ gfm: true, breaks: false });

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "blockquote", "hr", "br",
    "ul", "ol", "li",
    "strong", "em", "del", "code", "pre",
    "a", "span", "abbr",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    abbr: ["class", "title"],
    code: ["class"],
    pre: ["class", "tabindex", "role", "aria-label"],
    span: ["class", "title"],
    table: ["tabindex", "role", "aria-label"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Scrollable regions (wide tables, ASCII diagrams) must be keyboard-reachable
  // (WCAG 2.1.1). Make them focusable and announced as regions.
  transformTags: {
    table: sanitizeHtml.simpleTransform("table", {
      tabindex: "0",
      role: "region",
      "aria-label": "tabella",
    }),
    pre: sanitizeHtml.simpleTransform("pre", {
      tabindex: "0",
      role: "region",
      "aria-label": "blocco di codice",
    }),
  },
  // Drop the content of anything not allowed (e.g. <script>…</script>).
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: true,
};

/**
 * Grounded modules cite their sources inline as `[fonte: name]` (or
 * `[source: name]`), per the write_module prompt. Render those as a subtle
 * source pill so grounding reads as intentional provenance, not leftover markup.
 * Skips `<pre>` blocks so citation-shaped text inside code samples stays verbatim.
 * The source name is untrusted (LLM output / imported packages), so the sanitize
 * pass below is the real backstop. This only shapes the markup.
 */
function markCitations(html: string): string {
  const CITE = /\[(fonte|source)\s*:\s*([^\]\n]+)\]/gi;
  // Split keeps the <pre>…</pre> delimiters at odd indices, untouched.
  return html
    .split(/(<pre[\s\S]*?<\/pre>)/g)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(
            CITE,
            (_m, kw: string, name: string) =>
              `<span class="cite">${kw.toLowerCase()}: ${name.trim()}</span>`,
          ),
    )
    .join("");
}

const RX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(RX_SPECIAL, "\\$&");
}
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wrap the FIRST occurrence of each glossary term in an <abbr> carrying its
 * definition, so unexplained jargon becomes self-explaining. Only touches flowing
 * text, never inside <pre>/<code> (code samples), headings, links, or an <abbr>
 * already placed. All-caps/short terms match case-sensitively so "AS" never
 * matches the word "as"; longer terms match case-insensitively. sanitize-html
 * (below) is the backstop for untrusted definitions.
 */
function linkGlossaryTerms(html: string, terms: GlossaryTerm[]): string {
  if (terms.length === 0) return html;
  const W = "\\p{L}\\p{N}_-"; // "word" chars for boundaries (keeps AS_PATH intact)
  const sorted = [...terms]
    .filter((t) => t.term.length >= 2)
    .sort((a, b) => b.term.length - a.term.length);
  const used = new Set<string>();
  let depth = 0;
  const openRe = /^<(pre|code|h[1-6]|a|abbr)\b/i;
  const closeRe = /^<\/(pre|code|h[1-6]|a|abbr)\s*>/i;

  return html
    .split(/(<[^>]+>)/g)
    .map((seg) => {
      if (seg.startsWith("<")) {
        if (closeRe.test(seg)) depth = Math.max(0, depth - 1);
        else if (openRe.test(seg) && !seg.endsWith("/>")) depth += 1;
        return seg;
      }
      if (depth > 0 || !seg.trim()) return seg;

      const hits: { start: number; end: number; def: string }[] = [];
      for (const t of sorted) {
        const key = t.term.toLowerCase();
        if (used.has(key)) continue;
        const ci = !(t.term.length <= 3 || t.term === t.term.toUpperCase());
        const re = new RegExp(
          `(^|[^${W}])(${escapeRegex(t.term)})(?![${W}])`,
          ci ? "iu" : "u",
        );
        const m = re.exec(seg);
        if (!m || m[1] === undefined || m[2] === undefined) continue;
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (hits.some((h) => start < h.end && end > h.start)) continue;
        used.add(key);
        hits.push({ start, end, def: t.def });
      }
      if (hits.length === 0) return seg;

      hits.sort((a, b) => a.start - b.start);
      let out = "";
      let pos = 0;
      for (const h of hits) {
        out +=
          seg.slice(pos, h.start) +
          `<abbr class="term" title="${escapeAttr(h.def)}">${seg.slice(h.start, h.end)}</abbr>`;
        pos = h.end;
      }
      return out + seg.slice(pos);
    })
    .join("");
}

export interface Restoration {
  token: string;
  value: string;
  label: string;
}

/**
 * Put Contextia-protected operational values (IPs, hostnames) back where the
 * model placed their tokens, marked so the student sees the value came from the source
 * and never touched the model. Matching is tolerant: models occasionally emit
 * the token with ASCII angle brackets, extra spaces, or a wrapping code span,
 * so tokens are matched by their hash, not by exact literal. Any token whose
 * hash has no restoration (a mangled or hallucinated one) is collapsed to a
 * neutral marker instead of leaking raw token syntax to the student.
 * sanitize-html (below) is the backstop for the restored value.
 */
const CXT_TOKEN_RE = /[⟨<]\s*cxt:\s*([a-f0-9]{6,16})\s*[⟩>]/g;

function cxtSpan(label: string, value: string): string {
  return `<span class="cxt" title="${escapeAttr(label)}: protetto dall'AI da Contextia">${escapeAttr(value)}</span>`;
}

function restoreProtected(html: string, restorations: Restoration[]): string {
  const byHash = new Map<string, Restoration>();
  for (const r of restorations) {
    const hash = /([a-f0-9]{6,16})/.exec(r.token)?.[1];
    if (hash) byHash.set(hash, r);
  }
  return html.replace(CXT_TOKEN_RE, (raw, hash: string) => {
    const r = byHash.get(hash);
    if (r) return cxtSpan(r.label, r.value);
    return `<span class="cxt" title="valore protetto da Contextia">&#8226;&#8226;&#8226;</span>`;
  });
}

export function renderMarkdown(
  md: string,
  opts: { glossary?: GlossaryTerm[]; restorations?: Restoration[] } = {},
): string {
  const rawHtml = marked.parse(md, { async: false });
  const withCites = markCitations(rawHtml);
  const linked = opts.glossary?.length
    ? linkGlossaryTerms(withCites, opts.glossary)
    : withCites;
  // Always run, even with an empty restore map: an imported course carries the
  // placeholders but not the values, and that reader must see a neutral marker
  // rather than raw token syntax.
  const restored = restoreProtected(linked, opts.restorations ?? []);
  return sanitizeHtml(restored, SANITIZE_OPTS);
}
