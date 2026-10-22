/**
 * Workflow code runs in Temporal's deterministic sandbox: no file system, network or clock here.
 * Everything with side effects is an activity (activities.ts); this file only decides the order.
 */
import { log, proxyActivities } from "@temporalio/workflow";
import type { StageName } from "@reel/core";
import type { Activities } from "./activities.ts";

/** Same order as STAGES in @reel/core (checked by a test); copied because core cannot be bundled into the sandbox. */
export const STAGE_ORDER = ["script", "voice", "plan", "keyframes", "video", "assemble", "qa"] as const satisfies readonly StageName[];

const control = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

const stages = proxyActivities<Activities>({
  // Worst case is the video stage: 3 shots × 3 takes, each one up to a 30-minute provider job.
  startToCloseTimeout: "6 hours",
  heartbeatTimeout: "2 minutes",
  // Provider calls already retry inside the stage; these are retries of the whole stage
  // (worker crash, retries exhausted on a flaky provider). Finished work on disk is reused.
  retry: { maximumAttempts: 3, initialInterval: "30 seconds", backoffCoefficient: 2, nonRetryableErrorTypes: ["PermanentError"] },
});

export interface ReelRunArgs {
  runsRoot: string;
  runId: string;
  /** False for a fresh run; true to continue an existing one (skipping finished stages). */
  resume: boolean;
  /** With `resume`: recompute this stage and every later one. */
  from: StageName | null;
}

export async function reelRun({ runsRoot, runId, resume, from }: ReelRunArgs) {
  if (!(await control.prepareRun(runsRoot, runId, resume, from))) return { status: "failed" as const, final: null, costUsd: 0 };
  for (const stage of STAGE_ORDER) {
    try {
      await stages.runStage(runsRoot, runId, stage);
    } catch (err) {
      log.warn("stage failed", { runId, stage, error: String(err) });
      return control.finishRun(runsRoot, runId, stage);
    }
  }
  return control.finishRun(runsRoot, runId, null);
}
