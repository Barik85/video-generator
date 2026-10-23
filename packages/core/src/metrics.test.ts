import { describe, expect, it } from "vitest";
import { summarize, type RunMetrics } from "./metrics.ts";

const run = (o: Partial<RunMetrics>): RunMetrics => ({
  runId: "r", createdAt: "", version: "0.2.0", preset: "p", audio: "native", evalCase: null, status: "done", stoppedAt: null,
  qaPass: true, werVsIdea: 0, firstTakeVerbatim: true, dialogueTakes: 1, finalSeconds: 15, targetSeconds: 15, costUsd: 1,
  videoUsd: 0.9, workSeconds: 100, stageSeconds: {}, retries: 0, scriptRejections: 0, reviewRedos: 0, rating: null, ...o,
});

describe("summarize", () => {
  it("charges failed runs to the videos that did ship", () => {
    const s = summarize("k", [
      run({}),
      run({ status: "failed", stoppedAt: "qa", qaPass: false, werVsIdea: 0.25, firstTakeVerbatim: false, costUsd: 2 }),
      run({ status: "failed", stoppedAt: "review", werVsIdea: null, firstTakeVerbatim: null, costUsd: 0.1 }),
    ]);
    expect(s.doneRate).toBeCloseTo(1 / 3);
    expect(s.verbatimRate).toBe(0.5); // only runs whose final file was transcribed count
    expect(s.firstTakeRate).toBe(0.5);
    expect(s.costPerDone).toBeCloseTo(3.1); // all spend / one usable video
    expect(s.stops).toEqual({ qa: 1, review: 1 });
  });

  it("leaves rates empty when nothing could be measured (mock presets have no ASR)", () => {
    const s = summarize("k", [run({ werVsIdea: null, firstTakeVerbatim: null })]);
    expect(s.verbatimRate).toBeNull();
    expect(s.firstTakeRate).toBeNull();
    expect(s.meanRating).toBeNull();
  });
});
