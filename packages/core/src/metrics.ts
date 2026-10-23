import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRESETS, type PresetName } from "./config.ts";
import { STAGES, type Manifest, type MediaOutput, type QaOutput, type RunEvent } from "./schemas.ts";
import { extractQuotedLines, wordErrorRate } from "./util/text.ts";

/**
 * Metrics of one finished run, read only from its folder (manifest, stage outputs, events).
 * Nothing here calls a model: the report can be rebuilt at any time, for any old run.
 */
export interface RunMetrics {
  runId: string;
  createdAt: string;
  version: string;
  preset: string;
  audio: "native" | "lipsync" | "?";
  evalCase: string | null;
  status: Manifest["status"];
  /** Where it stopped: a stage name, "review" (rejected by a person), or null when done. */
  stoppedAt: string | null;
  qaPass: boolean | null;
  /** WER of the final file against the quoted lines of the *idea* (not the script): the task's own bar. */
  werVsIdea: number | null;
  /** Native audio: every dialogue shot passed ASR on its first take. Null when there is nothing to judge. */
  firstTakeVerbatim: boolean | null;
  dialogueTakes: number;
  finalSeconds: number | null;
  targetSeconds: number;
  costUsd: number;
  videoUsd: number;
  /** Sum of stage durations: processing time without time spent waiting for a reviewer. */
  workSeconds: number;
  stageSeconds: Partial<Record<string, number>>;
  /** Provider calls retried inside a stage. */
  retries: number;
  /** Script drafts the validator sent back to the LLM. */
  scriptRejections: number;
  reviewRedos: number;
  /** Manual 1–5 score from `reel rate`, if someone watched it. */
  rating: number | null;
}

export async function runMetrics(runsRoot: string, m: Manifest): Promise<RunMetrics> {
  const dir = path.join(runsRoot, m.runId);
  const json = async <T>(rel: string): Promise<T | null> =>
    existsSync(path.join(dir, rel)) ? (JSON.parse(await readFile(path.join(dir, rel), "utf8")) as T) : null;

  const events = existsSync(path.join(dir, "events.jsonl"))
    ? (await readFile(path.join(dir, "events.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunEvent)
    : [];
  const qa = m.stages.qa?.status === "done" ? await json<QaOutput>("qa.json") : null;
  const video = m.stages.video?.status === "done" ? await json<MediaOutput>("video.json") : null;
  const rating = await json<{ score: number }>("rating.json");

  const quoted = extractQuotedLines(m.input.idea);
  const werVsIdea = quoted.length && qa?.heardText ? wordErrorRate(quoted.join(" "), qa.heardText) : null;
  const dialogueShots = (video?.shots ?? []).filter((s) => s.wer !== null && s.wer !== undefined);

  const stageSeconds: Partial<Record<string, number>> = {};
  for (const s of STAGES) {
    const r = m.stages[s];
    if (r?.startedAt && r.finishedAt && r.status === "done") stageSeconds[s] = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;
  }
  const failed = STAGES.find((s) => m.stages[s]?.status === "failed");
  const rejected = m.reviews.at(-1)?.action === "reject";

  return {
    runId: m.runId,
    createdAt: m.createdAt,
    version: m.pipelineVersion,
    preset: m.input.preset,
    audio: m.input.preset in PRESETS ? PRESETS[m.input.preset as PresetName].audio : "?",
    evalCase: m.input.evalCase ?? null,
    status: m.status,
    stoppedAt: m.status === "done" ? null : rejected ? "review" : (failed ?? (qa && !qa.pass ? "qa" : "start")),
    qaPass: qa ? qa.pass : null,
    werVsIdea,
    firstTakeVerbatim: dialogueShots.length ? dialogueShots.every((s) => s.attempts === 1 && s.wer === 0) : null,
    dialogueTakes: dialogueShots.reduce((a, s) => a + s.attempts, 0),
    finalSeconds: m.status === "done" || qa ? Number.parseFloat(qa?.checks.find((c) => c.name === "duration")?.value ?? "") || null : null,
    targetSeconds: m.input.targetSeconds,
    costUsd: m.cost.totalUsd,
    videoUsd: m.cost.items.filter((i) => i.stage === "video").reduce((a, i) => a + i.usd, 0),
    workSeconds: Object.values(stageSeconds).reduce<number>((a, s) => a + (s ?? 0), 0),
    stageSeconds,
    retries: events.filter((e) => e.type === "retry").length,
    scriptRejections: events.filter((e) => e.type === "validation.fail").length,
    reviewRedos: m.reviews.filter((r) => r.action === "redo").length,
    rating: rating?.score ?? null,
  };
}

export interface GroupSummary {
  key: string;
  runs: number;
  /** Share of runs that ended done (QA passed). */
  doneRate: number;
  /** Among runs with an ASR transcript of the final file: share heard verbatim (WER 0 vs the idea). */
  verbatimRate: number | null;
  meanWer: number | null;
  /** Among native runs with dialogue: share where every dialogue shot passed on the first take. */
  firstTakeRate: number | null;
  meanCost: number;
  maxCost: number;
  /** Mean cost of a run that ended done: what one usable video costs, failures included. */
  costPerDone: number | null;
  meanWorkSeconds: number;
  retriesPerRun: number;
  meanRating: number | null;
  stops: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (xs: boolean[]) => mean(xs.map((x) => (x ? 1 : 0)));

export function summarize(key: string, rows: RunMetrics[]): GroupSummary {
  const done = rows.filter((r) => r.status === "done");
  const heard = rows.filter((r) => r.werVsIdea !== null);
  const native = rows.filter((r) => r.firstTakeVerbatim !== null);
  const total = rows.reduce((a, r) => a + r.costUsd, 0);
  const stops: Record<string, number> = {};
  for (const r of rows) if (r.stoppedAt) stops[r.stoppedAt] = (stops[r.stoppedAt] ?? 0) + 1;
  return {
    key,
    runs: rows.length,
    doneRate: rate(rows.map((r) => r.status === "done")) ?? 0,
    verbatimRate: rate(heard.map((r) => r.werVsIdea === 0)),
    meanWer: mean(heard.map((r) => r.werVsIdea!)),
    firstTakeRate: rate(native.map((r) => r.firstTakeVerbatim!)),
    meanCost: total / rows.length,
    maxCost: Math.max(...rows.map((r) => r.costUsd)),
    costPerDone: done.length ? total / done.length : null,
    meanWorkSeconds: mean(rows.map((r) => r.workSeconds)) ?? 0,
    retriesPerRun: mean(rows.map((r) => r.retries)) ?? 0,
    meanRating: mean(rows.filter((r) => r.rating !== null).map((r) => r.rating!)),
    stops,
  };
}
