import { describe, expect, it } from "vitest";
import {
  applyConcretenessEdits,
  editsAreTrustworthy,
} from "@/lib/llm/tasks/concreteness_pass/apply";
import { concretenessSchema } from "@/lib/llm/tasks/concreteness_pass/schema";

const BODY = [
  "## The idea",
  "",
  "The pipeline runs on a machine in the office.",
  "",
  "## In the real world",
  "",
  "| Piece | Role |",
  "|---|---|",
  "| grinder | sets the grind |",
  "",
  "Facilities pays for the descaler.",
].join("\n");

const parse = (o: unknown) => concretenessSchema.parse(o);

describe("applying the concreteness pass's edits", () => {
  it("replaces text the module actually contains", () => {
    const out = applyConcretenessEdits(
      BODY,
      parse({
        edits: [
          {
            find: "a machine in the office",
            replace: "the Gaggia Classic in the kitchen",
            why: "named the machine from the runbook",
          },
        ],
      }),
    );
    expect(out.applied).toBe(1);
    expect(out.rejected).toEqual([]);
    expect(out.bodyMd).toContain("the Gaggia Classic in the kitchen");
    // Everything it did not touch is untouched, tables included. A rewritten
    // body could drop this table and nothing would notice.
    expect(out.bodyMd).toContain("| grinder | sets the grind |");
  });

  it("refuses an edit that quotes text the module does not have", () => {
    // The model inventing the passage it claims to be fixing. Guessing where it
    // meant would put a replacement in the wrong place, which is worse than
    // leaving the module alone.
    const out = applyConcretenessEdits(
      BODY,
      parse({
        edits: [{ find: "the espresso machine downstairs", replace: "x" }],
      }),
    );
    expect(out.applied).toBe(0);
    expect(out.rejected).toEqual([
      { find: "the espresso machine downstairs", reason: "not found" },
    ]);
    expect(out.bodyMd).toBe(BODY);
  });

  it("refuses an edit whose text appears twice", () => {
    const twice = "the pump whines. the pump whines.";
    const out = applyConcretenessEdits(
      twice,
      parse({ edits: [{ find: "the pump whines", replace: "it chokes" }] }),
    );
    expect(out.applied).toBe(0);
    expect(out.rejected[0]?.reason).toBe("ambiguous");
    expect(out.bodyMd).toBe(twice);
  });

  it("keeps the good edits when one of several misses", () => {
    const out = applyConcretenessEdits(
      BODY,
      parse({
        edits: [
          { find: "Facilities pays", replace: "Facilities (Marta) pays" },
          { find: "nothing like this in the text", replace: "x" },
        ],
      }),
    );
    expect(out.applied).toBe(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.bodyMd).toContain("Facilities (Marta) pays");
  });

  it("applies edits in order, each to the result of the last", () => {
    const out = applyConcretenessEdits(
      "one two three",
      parse({
        edits: [
          { find: "two", replace: "TWO" },
          { find: "one TWO", replace: "start" },
        ],
      }),
    );
    expect(out.applied).toBe(2);
    expect(out.bodyMd).toBe("start three");
  });

  it("lets an edit delete a passage", () => {
    const out = applyConcretenessEdits(
      BODY,
      parse({ edits: [{ find: "\n\nFacilities pays for the descaler.", replace: "" }] }),
    );
    expect(out.applied).toBe(1);
    expect(out.bodyMd).not.toContain("Facilities pays");
  });

  it("treats an empty edit list as a correct answer", () => {
    // An already concrete module. The stage saying so costs almost nothing,
    // where the old shape had to re-emit the whole body to say the same.
    const out = applyConcretenessEdits(BODY, parse({ edits: [] }));
    expect(out.bodyMd).toBe(BODY);
    expect(out.applied).toBe(0);
    expect(editsAreTrustworthy(out)).toBe(true);
  });

  it("carries the why of applied edits as the notes, and drops the rest", () => {
    // A note describing a change that was refused would describe a module that
    // does not exist.
    const out = applyConcretenessEdits(
      BODY,
      parse({
        edits: [
          { find: "Facilities pays", replace: "Marta pays", why: "named who pays" },
          { find: "absent", replace: "x", why: "this one missed" },
        ],
        notes: ["the runbook does not say which grinder"],
      }),
    );
    expect(out.notes).toEqual([
      "named who pays",
      "the runbook does not say which grinder",
    ]);
  });
});

describe("deciding whether the edited body is worth keeping", () => {
  it("keeps a pass where most edits landed", () => {
    expect(
      editsAreTrustworthy({ bodyMd: "", notes: [], applied: 3, rejected: [{ find: "a", reason: "not found" }] }),
    ).toBe(true);
  });

  it("throws away a pass where most edits missed", () => {
    // Not a lightly imperfect edit: a model working from a text it could not
    // see properly. What did land is then as likely to be wrong as what did
    // not, so the draft is the safer body.
    expect(
      editsAreTrustworthy({
        bodyMd: "",
        notes: [],
        applied: 1,
        rejected: [
          { find: "a", reason: "not found" },
          { find: "b", reason: "not found" },
        ],
      }),
    ).toBe(false);
  });

  it("accepts a pass that proposed nothing at all", () => {
    expect(
      editsAreTrustworthy({ bodyMd: "", notes: [], applied: 0, rejected: [] }),
    ).toBe(true);
  });
});

describe("an edit cannot quietly remove a placeholder", () => {
  /**
   * A figure token stands for a picture stored in the database, and a cxt token
   * for a value Contextia is holding back. Neither is a word: dropping one
   * deletes a diagram from the course, or leaves a sentence about a value that
   * is no longer named, and neither shows up as an error anywhere. An editing
   * stage told to make prose concrete has every reason to tidy away something
   * that reads as noise, so this is refused rather than discouraged.
   */
  const body =
    "Ecco la rete di sede.\n\n⟨fig:9f2a1b3c4d5e⟩\n\nIl gateway è ⟨cxt:1a2b3c4d5e6f⟩ e risponde subito.";

  it("refuses one that deletes a figure", () => {
    const out = applyConcretenessEdits(body, {
      edits: [{ find: "⟨fig:9f2a1b3c4d5e⟩", replace: "uno schema della rete", why: "" }],
      notes: [],
    });
    expect(out.applied).toBe(0);
    expect(out.rejected[0]?.reason).toBe("drops a placeholder");
    expect(out.bodyMd).toContain("⟨fig:9f2a1b3c4d5e⟩");
  });

  it("refuses one that deletes a protected value", () => {
    const out = applyConcretenessEdits(body, {
      edits: [{ find: "è ⟨cxt:1a2b3c4d5e6f⟩ e", replace: "è 192.168.1.1 e", why: "" }],
      notes: [],
    });
    expect(out.applied).toBe(0);
    expect(out.bodyMd).toContain("⟨cxt:1a2b3c4d5e6f⟩");
  });

  it("allows one that rewrites around a token and carries it through", () => {
    // The legitimate case, and the reason this is a check on the token rather
    // than a ban on touching the line it sits on.
    const out = applyConcretenessEdits(body, {
      edits: [
        {
          find: "Il gateway è ⟨cxt:1a2b3c4d5e6f⟩ e risponde subito.",
          replace: "Il gateway della VLAN 10 è ⟨cxt:1a2b3c4d5e6f⟩, e risponde in meno di un millisecondo.",
          why: "aggiunta la VLAN e la latenza",
        },
      ],
      notes: [],
    });
    expect(out.applied).toBe(1);
    expect(out.bodyMd).toContain("⟨cxt:1a2b3c4d5e6f⟩");
    expect(out.bodyMd).toContain("VLAN 10");
  });

  it("leaves ordinary edits alone", () => {
    const out = applyConcretenessEdits(body, {
      edits: [{ find: "Ecco la rete di sede.", replace: "Ecco la rete della sede di Melano.", why: "" }],
      notes: [],
    });
    expect(out.applied).toBe(1);
  });
});
