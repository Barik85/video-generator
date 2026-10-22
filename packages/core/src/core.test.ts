import { describe, expect, it } from "vitest";
import { extractQuotedLines, normalizeWords, wordErrorRate } from "./util/text.ts";
import { validateScript } from "./stages/script.ts";
import type { Script } from "./schemas.ts";

describe("verbatim text utils", () => {
  it("extracts quoted lines in several quote styles", () => {
    expect(extractQuotedLines('She says: «You know what is inside.» He: "No."')).toEqual(["You know what is inside.", "No."]);
    expect(extractQuotedLines("He says “Run!” and „Stop“")).toEqual(["Run!", "Stop"]);
    expect(extractQuotedLines("no quotes here")).toEqual([]);
  });

  it("normalizes case, punctuation and apostrophes", () => {
    expect(normalizeWords("Don’t — STOP, naïve o'clock!")).toEqual(["don't", "stop", "naïve", "o'clock"]);
    expect(normalizeWords("[rain falling] You know. (door closes)")).toEqual(["you", "know"]);
  });

  it("WER is 0 for the same words and >0 for a paraphrase", () => {
    expect(wordErrorRate("You know what is inside.", "you know what is inside")).toBe(0);
    expect(wordErrorRate("Do not open it until morning", "do not open it until evening")).toBeCloseTo(1 / 6);
    expect(wordErrorRate("one two three", "one three")).toBeCloseTo(1 / 3);
  });
});

const base: Script = {
  title: "t",
  language: "en",
  logline: "l",
  style: "s",
  characters: [{ id: "a", name: "A", look: "x", voice: "female" }, { id: "b", name: "B", look: "y", voice: "male" }],
  lines: [{ id: "l1", characterId: "a", text: "You know what is inside." }],
  shots: [{ id: "s1", visual: "v", camera: "c", characterIds: ["a"], lineIds: ["l1"], approxSeconds: 5 }],
};

describe("validateScript", () => {
  it("accepts a script that keeps the quoted line verbatim", () => {
    expect(validateScript(base, ["You know what is inside."])).toEqual([]);
  });

  it("rejects a paraphrased quoted line", () => {
    const s = { ...base, lines: [{ id: "l1", characterId: "a", text: "You do know what is inside." }] };
    expect(validateScript(s, ["You know what is inside."])[0]).toMatch(/verbatim/);
  });

  it("rejects unused lines and two speakers in one shot", () => {
    const s: Script = {
      ...base,
      lines: [...base.lines, { id: "l2", characterId: "b", text: "No." }, { id: "l3", characterId: "b", text: "Yes." }],
      shots: [{ ...base.shots[0]!, lineIds: ["l1", "l2"] }],
    };
    const errs = validateScript(s, []).join(" | ");
    expect(errs).toMatch(/2 speakers/);
    expect(errs).toMatch(/line l3 must be used in exactly one shot/);
  });
});
