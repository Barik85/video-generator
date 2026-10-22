/**
 * Workflow code runs in Temporal's deterministic sandbox: no file system, network or clock here.
 * Everything with side effects is an activity (activities.ts); this file only decides the order.
 */
import { condition, defineSignal, log, proxyActivities, setHandler } from "@temporalio/workflow";
import type { ReviewDecision, ReviewGate, StageName } from "@reel/core";
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

/** A person's decision at a review gate. Sent from the UI, `reel review`, or the CLI prompt. */
export const reviewSignal = defineSignal<[ReviewDecision]>("review");

/** A run paused for review this long is stopped, so it does not wait forever. */
const REVIEW_TIMEOUT = "7 days";

export interface ReelRunArgs {
  runsRoot: string;
  runId: string;
  /** False for a fresh run; true to continue an existing one (skipping finished stages). */
  resume: boolean;
  /** With `resume`: recompute this stage and every later one. */
  from: StageName | null;
}

export async function reelRun({ runsRoot, runId, resume, from }: ReelRunArgs) {
  // Only a decision for the gate we are waiting at counts; late or duplicate ones are ignored.
  let waitingAt: ReviewGate | null = null;
  let decision: ReviewDecision | null = null;
  setHandler(reviewSignal, (d) => {
    if (d.gate === waitingAt && decision === null) decision = d;
  });

  const gates = await control.prepareRun(runsRoot, runId, resume, from);
  if (!gates) return { status: "failed" as const, final: null, costUsd: 0 };
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i]!;
    try {
      await stages.runStage(runsRoot, runId, stage);
    } catch (err) {
      log.warn("stage failed", { runId, stage, error: String(err) });
      return control.finishRun(runsRoot, runId, stage);
    }
    const gate = gates.find((g) => g === stage);
    if (!gate || !(await control.requestReview(runsRoot, runId, gate))) continue;

    waitingAt = gate;
    decision = null;
    const answered = await condition(() => decision !== null, REVIEW_TIMEOUT);
    waitingAt = null;
    const d: ReviewDecision = answered ? decision! : { gate, action: "reject", note: `no decision within ${REVIEW_TIMEOUT}` };
    await control.applyReview(runsRoot, runId, d);
    if (d.action === "reject") return control.finishRun(runsRoot, runId, stage);
    if (d.action === "redo") i--; // the same stage again, now with the reviewer's note
  }
  return control.finishRun(runsRoot, runId, null);
}
