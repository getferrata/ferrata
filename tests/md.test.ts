import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/md";

describe("renderMarkdown", () => {
  it("keeps the markdown structures module bodies use", () => {
    const html = renderMarkdown(
      "## Titolo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> analogia\n\n```\ndiagram\n```\n\n- uno\n- due\n\n**forte**",
    );
    expect(html).toContain("<h2>");
    // tables/pre carry a11y attributes (tabindex/role) for keyboard scroll access
    expect(html).toMatch(/<table[ >]/);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("<blockquote>");
    expect(html).toMatch(/<pre[ >]/);
    expect(html).toContain("<strong>forte</strong>");
  });

  it("strips scripts, event handlers, and raw HTML from untrusted content", () => {
    const html = renderMarkdown(
      'ciao <script>alert(1)</script> <img src=x onerror="alert(1)"> <div onclick="x">y</div>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<img");
  });

  it("drops javascript: links but keeps http links", () => {
    const evil = renderMarkdown("[x](javascript:alert(1))");
    expect(evil).not.toContain("javascript:");
    const ok = renderMarkdown("[docs](https://example.com)");
    expect(ok).toContain('href="https://example.com"');
  });

  it("renders grounding citations as a source pill, not raw brackets", () => {
    const html = renderMarkdown(
      "L'indice è UNIQUE [fonte: payments-runbook] e regge.",
    );
    expect(html).toContain('<span class="cite">fonte: payments-runbook</span>');
    expect(html).not.toContain("[fonte:");
  });

  it("leaves citation-shaped text inside code blocks verbatim", () => {
    const html = renderMarkdown("```\nlog[fonte: x]\n```");
    expect(html).toContain("log[fonte: x]");
    expect(html).not.toContain('class="cite"');
  });

  it("neutralizes markup smuggled into a citation name", () => {
    const html = renderMarkdown('ok [fonte: a<script>alert(1)</script>b] fine');
    expect(html).not.toContain("<script");
  });

  const glossary = [
    { term: "Ledger", def: "registro append-only" },
    { term: "AS", def: "Autonomous System" },
    { term: "Idempotency-Key", def: "UUID del client" },
  ];

  it("wraps the first occurrence of a glossary term in an abbr with its definition", () => {
    const html = renderMarkdown("Il Ledger è append-only. Il Ledger conta.", {
      glossary,
    });
    expect(html).toContain('<abbr class="term" title="registro append-only">Ledger</abbr>');
    // only the FIRST occurrence is wrapped
    expect(html.match(/<abbr/g)?.length).toBe(1);
  });

  it("matches short all-caps terms case-sensitively (AS, not the word 'as')", () => {
    const html = renderMarkdown("Questo vale, as detto, per l'AS 196810.", {
      glossary,
    });
    expect(html).toContain('title="Autonomous System">AS</abbr>');
    // "as" the lowercase word must not be linked
    expect(html).not.toMatch(/>as<\/abbr>/);
  });

  it("keeps hyphenated terms intact and never links inside code", () => {
    const html = renderMarkdown(
      "L'`Idempotency-Key` in codice, ma Idempotency-Key nel testo.",
      { glossary },
    );
    // the code span is untouched…
    expect(html).toContain("<code>Idempotency-Key</code>");
    // …and the prose occurrence is linked
    expect(html).toContain('title="UUID del client">Idempotency-Key</abbr>');
  });

  it("does not link terms when no glossary is passed", () => {
    const html = renderMarkdown("Il Ledger è append-only.");
    expect(html).not.toContain("<abbr");
  });

  it("restores a Contextia-protected token to a marked value span", () => {
    const html = renderMarkdown("Connettiti a ⟨cxt:9f2a1b3c4d⟩ in SSH.", {
      restorations: [
        { token: "⟨cxt:9f2a1b3c4d⟩", value: "10.0.0.5", label: "Private IP address" },
      ],
    });
    expect(html).toContain('<span class="cxt"');
    expect(html).toContain("10.0.0.5");
    expect(html).not.toContain("⟨cxt:");
  });

  it("restores tokens the model mangled: spaces, ASCII brackets, code spans", () => {
    const restorations = [
      { token: "⟨cxt:9f2a1b3c4d⟩", value: "10.0.0.5", label: "Private IP address" },
    ];
    for (const variant of [
      "Vai su ⟨ cxt:9f2a1b3c4d ⟩ ora.",
      "Vai su `⟨cxt:9f2a1b3c4d⟩` ora.",
      "curl -sk https://⟨cxt:9f2a1b3c4d⟩:8443/healthz",
    ]) {
      const html = renderMarkdown(variant, { restorations });
      expect(html, variant).toContain("10.0.0.5");
      expect(html, variant).not.toContain("cxt:9f2a1b3c4d");
    }
  });

  it("collapses an orphan token to a neutral marker, never raw syntax", () => {
    const html = renderMarkdown("L'host ⟨cxt:deadbeef00⟩ risponde.", {
      restorations: [
        { token: "⟨cxt:9f2a1b3c4d⟩", value: "10.0.0.5", label: "Private IP address" },
      ],
    });
    expect(html).not.toContain("cxt:deadbeef00");
    expect(html).toContain("value protected by Contextia");
  });
});

describe("a course that arrived from someone else", () => {
  it("shows a neutral marker where the placeholders are, not raw token syntax", () => {
    // The importing instance holds no restore map for this course. Until this
    // was handled, the reader saw the literal token.
    const html = renderMarkdown("Il db è ⟨cxt:ab12cd34ef⟩ in produzione.");
    expect(html).not.toContain("cxt:ab12cd34ef");
    expect(html).toContain("•••");
  });
});

describe("citations point at documents that exist", () => {
  const sources = ["runbook-rilascio-base.md", "architettura.md"];

  it("repairs a name the model mangled while copying it", () => {
    // The real course cited "runbookrilebasico.md" for a file whose name was
    // longer. The pill named a document nobody could open.
    const html = renderMarkdown(
      "Il rollback si fa così [fonte: runbook-rilascio_base].",
      { sources },
    );
    expect(html).toContain("runbook-rilascio-base.md");
    expect(html).not.toContain("cite-unknown");
  });

  it("leaves an exact citation exactly as written", () => {
    const html = renderMarkdown("Vedi [fonte: architettura.md] per il resto.", {
      sources,
    });
    expect(html).toContain("architettura.md");
    expect(html).not.toContain("cite-unknown");
  });

  it("marks a citation naming a document the course does not have", () => {
    const html = renderMarkdown("Come da [fonte: policy-sicurezza.md].", {
      sources,
    });
    expect(html).toContain("cite-unknown");
    expect(html).toContain("policy-sicurezza.md");
  });

  it("refuses to guess when two sources are equally close", () => {
    const html = renderMarkdown("Vedi [fonte: runbook].", {
      sources: ["runbook-a.md", "runbook-b.md"],
    });
    // Repointing at the wrong document would be worse than admitting the doubt.
    expect(html).toContain("cite-unknown");
  });

  it("renders citations unchanged when the sources are unknown", () => {
    // An imported package carries no source list; the citation is still the
    // author's and must read normally.
    const html = renderMarkdown("Vedi [fonte: qualcosa.md].");
    expect(html).toContain("qualcosa.md");
    expect(html).not.toContain("cite-unknown");
  });
});
