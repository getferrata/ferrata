import { describe, expect, it } from "vitest";
import { courseMarkdown, type DumpCourse } from "@/lib/course/dump";

const plain = {
  restore: (s: string) => s,
  figure: () => null,
};

function course(over: Partial<DumpCourse> = {}): DumpCourse {
  return {
    title: "A course",
    objective: null,
    concretenessRule: null,
    startLevel: null,
    scheduleMd: null,
    glossaryMd: null,
    modules: [],
    ...over,
  };
}

describe("courseMarkdown", () => {
  it("puts the answers after the questions, not beside them", () => {
    const md = courseMarkdown(
      course({
        modules: [
          {
            title: "Routing",
            minutes: 30,
            bodyMd: "The body.",
            questions: [
              { prompt: "What is BGP?", expectedAnswer: "A path vector protocol.", options: null },
              { prompt: "On what port?", expectedAnswer: "179.", options: null },
            ],
          },
        ],
      }),
      plain,
    );

    // Reading the answer the moment you read the question is not a test, so
    // every question has to come before the first answer.
    const firstAnswer = md.indexOf("A path vector protocol.");
    const lastQuestion = md.indexOf("On what port?");
    expect(lastQuestion).toBeGreaterThan(-1);
    expect(firstAnswer).toBeGreaterThan(lastQuestion);
    expect(md).toContain("### Test");
    expect(md).toContain("### Answers");
  });

  it("letters the options of a multiple choice question", () => {
    const md = courseMarkdown(
      course({
        modules: [
          {
            title: "M",
            minutes: 10,
            bodyMd: "b",
            questions: [
              { prompt: "Which?", expectedAnswer: "b", options: ["first", "second"] },
            ],
          },
        ],
      }),
      plain,
    );
    expect(md).toContain("a) first");
    expect(md).toContain("b) second");
  });

  it("says a module was never written rather than printing an empty one", () => {
    const md = courseMarkdown(
      course({
        modules: [{ title: "Gap", minutes: 20, bodyMd: null, questions: [] }],
      }),
      plain,
    );
    expect(md).toContain("## 00. Gap");
    expect(md).toContain("never written");
    expect(md).not.toContain("### Test");
  });

  it("puts protected values back, everywhere they appear", () => {
    const md = courseMarkdown(
      course({
        modules: [
          {
            title: "The edge",
            minutes: 15,
            bodyMd: "Reach ⟨cxt:aa11⟩ from the jump host.",
            questions: [
              {
                prompt: "What answers on ⟨cxt:aa11⟩?",
                expectedAnswer: "The router at ⟨cxt:aa11⟩.",
                options: null,
              },
            ],
          },
        ],
      }),
      {
        restore: (s) => s.split("⟨cxt:aa11⟩").join("10.20.0.1"),
        figure: () => null,
      },
    );
    expect(md).not.toContain("⟨cxt:");
    // Body, prompt and answer all go through it: a placeholder left in one of
    // the three is exactly the kind of thing nobody notices until they read it.
    expect(md.match(/10\.20\.0\.1/g)).toHaveLength(3);
  });

  it("turns a figure token into an image the file next to it can show", () => {
    const md = courseMarkdown(
      course({
        modules: [
          {
            title: "Topology",
            minutes: 10,
            bodyMd: "Here it is:\n\n⟨fig:9f2a1b3c4d5e⟩\n\nAnd on we go.",
            questions: [],
          },
        ],
      }),
      {
        restore: (s) => s,
        figure: (short) => ({ path: `pics/${short}.png`, alt: "the topology" }),
      },
    );
    expect(md).toContain("![the topology](pics/9f2a1b3c4d5e.png)");
    expect(md).not.toContain("⟨fig:");
  });

  it("leaves a token alone when nothing stands behind it", () => {
    const md = courseMarkdown(
      course({
        modules: [
          {
            title: "Topology",
            minutes: 10,
            bodyMd: "⟨fig:9f2a1b3c4d5e⟩",
            questions: [],
          },
        ],
      }),
      plain,
    );
    // A picture the author withdrew must not quietly reappear, and a token
    // with nothing behind it is a visible sign rather than a silent gap.
    expect(md).toContain("⟨fig:9f2a1b3c4d5e⟩");
  });

  it("carries the front matter and the tail sections", () => {
    const md = courseMarkdown(
      course({
        objective: "Hold your own in the interview.",
        concretenessRule: "Say where it lives and who pays.",
        startLevel: "strong on Linux",
        scheduleMd: "Day one: modules 0 to 3.",
        glossaryMd: "**BGP**: the protocol.",
        modules: [{ title: "M", minutes: 60, bodyMd: "b", questions: [] }],
      }),
      plain,
    );
    expect(md).toContain("Hold your own in the interview.");
    expect(md).toContain("Rule number one.");
    expect(md).toContain("strong on Linux");
    expect(md).toContain("1 modules, about 1 hours of study.");
    expect(md).toContain("## Schedule");
    expect(md).toContain("## Glossary");
  });

  it("omits the tail sections a course does not have", () => {
    const md = courseMarkdown(course(), plain);
    expect(md).not.toContain("## Schedule");
    expect(md).not.toContain("## Glossary");
    expect(md.startsWith("# A course")).toBe(true);
  });
});
