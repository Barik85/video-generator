import { describe, expect, it } from "vitest";
import { extractQuotedLines, normalizeWords, wordErrorRate } from "./util/text.ts";
import { validateScript } from "./stages/script.ts";
import type { Script } from "./schemas.ts";

describe("verbatim text utils", () => {
  it("extracts quoted lines in several quote styles", () => {
    expect(extractQuotedLines('Вона каже: «Ти знаєш, що там.» А він: "Ні."')).toEqual(["Ти знаєш, що там.", "Ні."]);
    expect(extractQuotedLines("He says “Run!” and „Stop“")).toEqual(["Run!", "Stop"]);
    expect(extractQuotedLines("no quotes here")).toEqual([]);
  });

  it("normalizes case, punctuation and apostrophes", () => {
    expect(normalizeWords("Don’t — STOP, м'ята!")).toEqual(["don't", "stop", "м'ята"]);
  });

  it("WER is 0 for the same words and >0 for a paraphrase", () => {
    expect(wordErrorRate("Ти знаєш, що там.", "ти знаєш що там")).toBe(0);
    expect(wordErrorRate("Не відкривай до ранку", "не відкривай до вечора")).toBeCloseTo(0.25);
    expect(wordErrorRate("one two three", "one three")).toBeCloseTo(1 / 3);
  });
});

const base: Script = {
  title: "t",
  language: "uk",
  logline: "l",
  style: "s",
  characters: [{ id: "a", name: "A", look: "x", voice: "female" }, { id: "b", name: "B", look: "y", voice: "male" }],
  lines: [{ id: "l1", characterId: "a", text: "Ти знаєш, що там." }],
  shots: [{ id: "s1", visual: "v", camera: "c", characterIds: ["a"], lineIds: ["l1"], approxSeconds: 5 }],
};

describe("validateScript", () => {
  it("accepts a script that keeps the quoted line verbatim", () => {
    expect(validateScript(base, ["Ти знаєш, що там."])).toEqual([]);
  });

  it("rejects a paraphrased quoted line", () => {
    const s = { ...base, lines: [{ id: "l1", characterId: "a", text: "Ти ж знаєш, що там." }] };
    expect(validateScript(s, ["Ти знаєш, що там."])[0]).toMatch(/verbatim/);
  });

  it("rejects unused lines and two speakers in one shot", () => {
    const s: Script = {
      ...base,
      lines: [...base.lines, { id: "l2", characterId: "b", text: "Ні." }, { id: "l3", characterId: "b", text: "Так." }],
      shots: [{ ...base.shots[0]!, lineIds: ["l1", "l2"] }],
    };
    const errs = validateScript(s, []).join(" | ");
    expect(errs).toMatch(/2 speakers/);
    expect(errs).toMatch(/line l3 must be used in exactly one shot/);
  });
});
