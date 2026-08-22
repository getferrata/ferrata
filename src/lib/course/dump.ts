/**
 * A course as one markdown document.
 *
 * Separate from the portable package on purpose. The package is a shareable
 * artifact: a manifest, a provenance row, a hash, and a refusal to carry a
 * value the protection rules hold back. This is the author reading their own
 * course somewhere that is not a browser tab, on a train or on paper, and the
 * only thing it owes anybody is being readable.
 *
 * Pure: what a picture becomes and what a protected placeholder becomes are
 * both passed in. Writing files is the caller's problem, which is what makes
 * this testable without a database or a disk.
 */

export interface DumpQuestion {
  prompt: string;
  expectedAnswer: string;
  /** Multiple choice options, when the question has them. */
  options: string[] | null;
}

export interface DumpModule {
  title: string;
  minutes: number;
  bodyMd: string | null;
  questions: DumpQuestion[];
}

export interface DumpCourse {
  title: string;
  objective: string | null;
  concretenessRule: string | null;
  startLevel: string | null;
  scheduleMd: string | null;
  glossaryMd: string | null;
  modules: DumpModule[];
}

export interface DumpOptions {
  /** Put protected values back in clear. Identity when there are none. */
  restore: (text: string) => string;
  /**
   * What a figure token becomes, or null to leave the token alone. Returning
   * null rather than dropping it is deliberate: a picture the author withdrew
   * should not silently reappear, and a token with nothing behind it is a
   * visible sign that something is missing rather than a gap nobody notices.
   */
  figure: (short: string) => { path: string; alt: string } | null;
}

const FIGURE_TOKEN = /⟨fig:([0-9a-f]{8,32})⟩/g;

export function courseMarkdown(course: DumpCourse, opts: DumpOptions): string {
  const out: string[] = [];
  const text = (s: string): string =>
    opts.restore(s).replace(FIGURE_TOKEN, (whole, short: string) => {
      const fig = opts.figure(short);
      return fig ? `![${fig.alt}](${fig.path})` : whole;
    });

  out.push(`# ${course.title}`, "");
  if (course.objective) out.push(text(course.objective), "");
  if (course.concretenessRule) {
    out.push(`> **Rule number one.** ${text(course.concretenessRule)}`, "");
  }
  if (course.startLevel) out.push(`Starting level: ${course.startLevel}`, "");
  const minutes = course.modules.reduce((s, m) => s + m.minutes, 0);
  out.push(
    `${course.modules.length} modules, about ${Math.round(minutes / 60)} hours of study.`,
    "",
  );

  course.modules.forEach((m, i) => {
    out.push("", "---", "");
    out.push(`## ${String(i).padStart(2, "0")}. ${m.title}`, "");
    out.push(`*~${m.minutes} minutes*`, "");
    if (!m.bodyMd) {
      out.push("*This module was never written.*", "");
      return;
    }
    out.push(text(m.bodyMd), "");
    if (m.questions.length === 0) {
      out.push("*No tests on this module.*", "");
      return;
    }

    // Questions first, answers after, rather than interleaved. Reading the
    // answer the moment you read the question is not a test, and a document
    // meant for studying should not put the two on the same line.
    out.push("### Test", "");
    m.questions.forEach((q, n) => {
      out.push(`**${n + 1}.** ${text(q.prompt)}`, "");
      if (q.options) {
        q.options.forEach((opt, k) =>
          out.push(`   ${String.fromCharCode(97 + k)}) ${text(opt)}`),
        );
        out.push("");
      }
    });
    out.push("### Answers", "");
    m.questions.forEach((q, n) => {
      out.push(`**${n + 1}.** ${text(q.expectedAnswer)}`, "");
    });
  });

  if (course.scheduleMd) {
    out.push("", "---", "", "## Schedule", "", text(course.scheduleMd), "");
  }
  if (course.glossaryMd) {
    out.push("", "---", "", "## Glossary", "", text(course.glossaryMd), "");
  }

  return out.join("\n");
}
