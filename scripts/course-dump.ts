/**
 * Write a course out as one markdown file, with its pictures beside it.
 *
 *   pnpm course:dump <course-id> [directory]
 *
 * The course as a reader gets it: every module in order, its body, its tests
 * and the answers, the schedule and the glossary. Not the portable package,
 * which is a shareable artifact with a manifest and a provenance row; this is
 * the author reading their own course somewhere other than a browser tab.
 *
 * To a file and never to the terminal, because a course is tens of thousands
 * of characters and scrollback is not a place to study.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCourseBundle } from "@/lib/course/query";
import { courseMarkdown, type DumpQuestion } from "@/lib/course/dump";
import { listFigures, figureBytes } from "@/lib/sources/figures";
import { slug } from "@/lib/package/export";
import { loadLocalEnv } from "@/lib/env";

function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}

/** png from image/png, and jpg rather than jpeg because that is what people type. */
function extensionFor(mime: string): string {
  const sub = mime.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub.replace(/[^a-z0-9]/g, "");
}

function parseOptions(optionsJson: string | null): string[] | null {
  if (!optionsJson) return null;
  try {
    const v = JSON.parse(optionsJson) as { options?: unknown };
    return Array.isArray(v.options)
      ? v.options.filter((o): o is string => typeof o === "string")
      : null;
  } catch {
    return null;
  }
}

function main(): void {
  loadLocalEnv();
  const id = process.argv[2];
  if (!id) {
    say("Usage: pnpm course:dump <course-id> [directory]");
    say("Run pnpm course:context with no arguments to list the ids.");
    process.exitCode = 1;
    return;
  }
  const bundle = getCourseBundle(id);
  if (!bundle) {
    say(`No course with id ${id}.`);
    process.exitCode = 1;
    return;
  }

  const dir = resolve(process.argv[3] ?? ".");
  const name = slug(bundle.course.title);
  const assetDir = `${name}-figures`;

  // Only approved pictures, because those are the ones the course shows. A
  // withdrawn figure is a decision the author made, and putting it back in the
  // file they study from would quietly undo it.
  const approved = new Map(
    listFigures(id, "approved").map((f) => [f.sha256.slice(0, 12), f]),
  );
  const written = new Map<string, string>();

  const markdown = courseMarkdown(
    {
      title: bundle.course.title,
      objective: bundle.course.objective,
      concretenessRule: bundle.course.concretenessRule,
      startLevel: bundle.course.startLevel,
      scheduleMd: bundle.course.scheduleMd,
      glossaryMd: bundle.course.glossaryMd,
      modules: bundle.modules.map((m) => ({
        title: m.concept.title,
        minutes: m.concept.estimatedMinutes,
        bodyMd: m.module?.bodyMd ?? null,
        // Answers included, because whoever runs this owns the course. A
        // student gets the tests through the app, which withholds them.
        // Retired questions belong to a module nobody is reading any more.
        questions: m.questions
          .filter((q) => q.retiredAt === null)
          .map(
            (q): DumpQuestion => ({
              prompt: q.prompt,
              expectedAnswer: q.expectedAnswer,
              options: parseOptions(q.optionsJson),
            }),
          ),
      })),
    },
    {
      // An empty value means the row is sealed and FERRATA_SECRET_KEY is not
      // set. Substituting it would delete the word from the sentence and leave
      // a document that reads like a typo instead of one that says something
      // is missing, so those keep their token and get counted below.
      restore: (text) => {
        let out = text;
        for (const r of bundle.restorations) {
          if (r.value === "") continue;
          out = out.split(r.token).join(r.value);
        }
        return out;
      },
      figure: (short) => {
        const fig = approved.get(short);
        if (!fig) return null;
        let path = written.get(short);
        if (!path) {
          const bytes = figureBytes(id, fig.id);
          if (!bytes) return null;
          mkdirSync(join(dir, assetDir), { recursive: true });
          path = `${assetDir}/${short}.${extensionFor(bytes.mime)}`;
          writeFileSync(join(dir, path), bytes.data);
          written.set(short, path);
        }
        return { path, alt: fig.altText ?? "figure" };
      },
    },
  );

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  writeFileSync(file, markdown, "utf8");

  say(`Wrote ${file}`);
  say(`  ${bundle.modules.length} modules, ${markdown.length} characters`);
  const sealed = bundle.restorations.filter((r) => r.value === "").length;
  if (sealed > 0) {
    say(
      `  ${sealed} protected value(s) could not be opened and are left as ⟨cxt:…⟩ in the file.`,
    );
    say(
      `  They are sealed with FERRATA_SECRET_KEY. Set it in .env.local and run this again.`,
    );
  }
  if (written.size > 0) {
    say(`  ${written.size} pictures in ${join(dir, assetDir)}`);
  } else if (approved.size > 0) {
    say(
      `  ${approved.size} approved pictures, none placed in a module: run pnpm course:context ${id}`,
    );
  }
}

main();
