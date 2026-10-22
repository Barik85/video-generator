import { RunStore } from "./run-store.ts";
import { providersFor, type Providers } from "./providers/index.ts";
import { STAGES, type Manifest, type RunEvent, type RunInput, type StageName } from "./schemas.ts";
import type { AssembleOutput, MediaOutput, PlanOutput, Script, VoiceOutput } from "./schemas.ts";
import { makeContext, errMsg, type StageContext } from "./stages/context.ts";
import { scriptStage } from "./stages/script.ts";
import { voiceStage } from "./stages/voice.ts";
import { planStage } from "./stages/plan.ts";
import { keyframesStage } from "./stages/keyframes.ts";
import { videoStage } from "./stages/video.ts";
import { assembleStage, qaStage } from "./stages/assemble-qa.ts";
import { PermanentError } from "./util/retry.ts";

export interface RunOptions {
  /** Directory holding all run folders, e.g. ./runs */
  runsRoot: string;
  onEvent?: (e: RunEvent) => void;
  /** Called once the run folder exists — lets a server return the id before the run finishes. */
  onCreated?: (runId: string) => void;
}

/** In-process runner: runs every stage in this process, one after another. */
export async function startRun(opts: RunOptions & { input: RunInput }): Promise<Manifest> {
  const store = await RunStore.create(opts.runsRoot, opts.input);
  opts.onCreated?.(store.runId);
  return execute(store, opts);
}

/** Continue a run: completed stages are skipped; `from` forces that stage and everything after it to recompute. */
export async function resumeRun(opts: RunOptions & { runId: string; from?: StageName }): Promise<Manifest> {
  const store = await RunStore.open(opts.runsRoot, opts.runId);
  opts.onCreated?.(store.runId);
  await prepareResume(store, opts.from);
  return execute(store, opts);
}

async function execute(store: RunStore, opts: RunOptions): Promise<Manifest> {
  if (opts.onEvent) store.onEvent(opts.onEvent);
  const providers = await beginRun(store);
  if (!providers) return store.get();
  for (const stage of STAGES) {
    try {
      await executeStage(store, providers, stage);
    } catch {
      return finishRun(store, stage);
    }
  }
  return finishRun(store, null);
}

/*
 * The steps below are shared by every runner: the in-process loop above and the Temporal workflow
 * (packages/temporal), which calls each of them as an activity. All state goes through the run
 * folder, so a step can run in a different process from the one before it.
 */

type Outputs = {
  script: Script;
  voice: VoiceOutput;
  plan: PlanOutput;
  keyframes: MediaOutput;
  video: MediaOutput;
  assemble: AssembleOutput;
};

// Each stage declares its inputs explicitly; they come from earlier stages' saved JSON.
const RUNNERS: Record<StageName, (ctx: StageContext, o: Partial<Outputs>) => Promise<unknown>> = {
  script: (ctx) => scriptStage(ctx),
  voice: (ctx, o) => voiceStage(ctx, o.script!),
  plan: (ctx, o) => planStage(ctx, o.script!, o.voice!),
  keyframes: (ctx, o) => keyframesStage(ctx, o.script!),
  video: (ctx, o) => videoStage(ctx, o.script!, o.plan!, o.keyframes!),
  assemble: (ctx, o) => assembleStage(ctx, o.plan!, o.video!),
  qa: (ctx, o) => qaStage(ctx, o.script!, o.plan!, o.assemble!),
};

/** Marks the run running again; with `from`, that stage and every later one are recomputed. */
export async function prepareResume(store: RunStore, from?: StageName) {
  if (from) await store.invalidateFrom(from);
  else await store.setStatus("running");
}

/** Builds the providers for the run's preset. Null (and the run marked failed) if the preset cannot run. */
export async function beginRun(store: RunStore): Promise<Providers | null> {
  const { preset, budgetUsd } = store.get().input;
  try {
    const providers = providersFor(preset);
    await store.event("run", "run.start", `run ${store.runId} (preset ${preset}, budget $${budgetUsd})`);
    return providers;
  } catch (err) {
    await store.event("run", "run.fail", errMsg(err));
    await store.setStatus("failed");
    return null;
  }
}

/**
 * Runs one stage and saves its output, or skips it if it is already done. On failure the stage is
 * recorded as failed and the error is rethrown: the caller decides whether to retry or stop.
 */
export async function executeStage(store: RunStore, providers: Providers, stage: StageName): Promise<"done" | "skipped"> {
  const rec = store.stage(stage);
  if (rec.status === "done" && rec.output) return "skipped";
  const outputs: Partial<Outputs> = {};
  for (const s of STAGES.slice(0, STAGES.indexOf(stage))) {
    const prev = store.stage(s);
    if (prev.status !== "done" || !prev.output) throw new PermanentError(`${stage} needs ${s}, which has not finished`);
    (outputs as Record<string, unknown>)[s] = await store.readJson(prev.output);
  }

  const started = Date.now();
  await store.updateStage(stage, { status: "running", attempts: rec.attempts + 1, startedAt: new Date().toISOString(), error: null });
  await store.event(stage, "stage.start", `${stage} started`);
  try {
    const result = await RUNNERS[stage](makeContext(stage, store, providers), outputs);
    const rel = `${stage}.json`;
    await store.writeJson(rel, result);
    await store.updateStage(stage, { status: "done", finishedAt: new Date().toISOString(), output: rel });
    await store.event(stage, "stage.done", `${stage} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return "done";
  } catch (err) {
    const kind = err instanceof PermanentError ? "permanent" : "transient (retries exhausted)";
    await store.updateStage(stage, { status: "failed", finishedAt: new Date().toISOString(), error: errMsg(err) });
    await store.event(stage, "stage.fail", `${stage} failed, ${kind}: ${errMsg(err)}`);
    throw err;
  }
}

/** Sets the final run status: failed at `failedStage`, or done/failed by the QA verdict. */
export async function finishRun(store: RunStore, failedStage: StageName | null): Promise<Manifest> {
  if (failedStage) {
    await store.setStatus("failed");
    return store.get();
  }
  const qa = (await store.readJson<{ pass: boolean }>("qa.json")).pass;
  await store.setStatus(qa ? "done" : "failed", "final.mp4");
  await store.event("run", qa ? "run.done" : "run.fail", qa ? `done: final.mp4, $${store.get().cost.totalUsd.toFixed(2)}` : "QA failed; final.mp4 kept for inspection");
  return store.get();
}
