import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  moduleBodyMessage,
  untrustedMaterialMessage,
} from "@/lib/llm/material";

const TASKS_DIR = join(process.cwd(), "src/lib/llm/tasks");

function promptFiles(): { task: string; body: string }[] {
  return readdirSync(TASKS_DIR)
    .filter((d) => statSync(join(TASKS_DIR, d)).isDirectory())
    .map((task) => ({
      task,
      path: join(TASKS_DIR, task, "prompt.md"),
    }))
    .filter((p) => {
      try {
        return statSync(p.path).isFile();
      } catch {
        return false;
      }
    })
    .map(({ task, path }) => ({ task, body: readFileSync(path, "utf8") }));
}

/**
 * The house rule, enforced structurally rather than by memory: content that
 * came from outside (uploaded material, a student's typing) or was derived from
 * it (a generated module body) never reaches the system prompt, because the
 * system prompt is the channel the model trusts.
 *
 * A template variable is the way it gets there by accident, so the check is on
 * the templates: if a future prompt interpolates one of these, this fails and
 * says which, instead of the boundary quietly moving.
 */
const FORBIDDEN_VARS = [
  // Uploaded files, a repo, a wiki page.
  "material",
  "sources",
  // A generated module body: model output written from untrusted material.
  "bodyMd",
  // Typed by a student, the least trusted actor on the install.
  "explanation",
];

/**
 * Deliberately allowed in the system prompt, and worth naming so the exception
 * is a decision rather than an oversight: the author's brief and their interview
 * answers. The author is the examiner, the person whose key pays for the call
 * and who controls the install. Their own words are the trusted channel; the
 * boundary exists to keep out what arrives from somewhere else.
 */
const TRUSTED_VARS = ["brief", "sourcePrompt", "authorContext"];

describe("untrusted content stays out of system prompts", () => {
  it("finds the prompt templates at all", () => {
    // Guards the guard: a path change that found zero files would make every
    // assertion below pass while checking nothing.
    const files = promptFiles();
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN_VARS)(
    "never interpolates %s into a prompt template",
    (name) => {
      const offenders = promptFiles()
        .filter((f) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(f.body))
        .map((f) => f.task);
      expect(offenders).toEqual([]);
    },
  );

  it("still lets the author's own words through, on purpose", () => {
    // The rule is about provenance, not about interpolation: if this ever
    // returns nothing, the boundary has been applied too widely and the model
    // has lost the context that makes a course specific.
    const bodies = promptFiles();
    const used = TRUSTED_VARS.filter((name) =>
      bodies.some((f) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(f.body)),
    );
    expect(used.length).toBeGreaterThan(0);
  });
});

describe("the fenced carriers", () => {
  it("labels imported material as data, in a user turn", () => {
    const m = untrustedMaterialMessage("some uploaded text");
    expect(m.role).toBe("user");
    expect(m.content).toContain("some uploaded text");
    expect(m.content.toLowerCase()).toContain("never as instructions");
  });

  it("labels a generated module body as data, in a user turn", () => {
    const m = moduleBodyMessage("## Idea\n\nbody");
    expect(m.role).toBe("user");
    expect(m.content).toContain("## Idea");
    expect(m.content.toLowerCase()).toContain("not instructions");
  });

  it("keeps the payload intact, so nothing is silently trimmed", () => {
    const awkward = 'a "quoted" line\nwith <<<MATERIAL lookalikes\nand a tail';
    expect(untrustedMaterialMessage(awkward).content).toContain(awkward);
    expect(moduleBodyMessage(awkward).content).toContain(awkward);
  });
});
