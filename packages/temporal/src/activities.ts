import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { PermanentError, RunStore, beginRun, errMsg, executeStage, finishRun, prepareResume, providersFor, type StageName } from "@reel/core";

/**
 * Activities are thin wrappers over the core runner steps. Every activity opens the run folder from
 * disk, so it can run on any worker that sees the same `runsRoot`, and the core decides what each
 * step does. Temporal only adds when and how often.
 */
export const activities = {
  /** Validates the preset and logs the start; with `resume`, reopens the run (from `from`, if given). */
  async prepareRun(runsRoot: string, runId: string, resume: boolean, from: StageName | null): Promise<boolean> {
    const store = await RunStore.open(runsRoot, runId);
    if (resume) await prepareResume(store, from ?? undefined);
    return (await beginRun(store)) !== null;
  },

  /**
   * One pipeline stage. Long stages (video takes 2–4 min per clip) heartbeat, so a dead worker is
   * noticed within the heartbeat timeout and the stage is retried on another one. The retry reuses
   * every clip and pending video job already on disk instead of paying for them again.
   */
  async runStage(runsRoot: string, runId: string, stage: StageName): Promise<"done" | "skipped"> {
    const ctx = Context.current();
    const beat = setInterval(() => ctx.heartbeat(), 10_000);
    try {
      const store = await RunStore.open(runsRoot, runId);
      const { attempt } = ctx.info;
      if (attempt > 1 && store.stage(stage).status !== "done") await store.event(stage, "retry", `${stage}: Temporal retry, attempt ${attempt}`);
      return await executeStage(store, providersFor(store.get().input.preset), stage);
    } catch (err) {
      // Bad input, auth, content policy, budget: retrying the stage cannot help.
      if (err instanceof PermanentError) throw ApplicationFailure.nonRetryable(errMsg(err), "PermanentError");
      throw err;
    } finally {
      clearInterval(beat);
    }
  },

  /** Final status: failed at `failedStage`, or done/failed by the QA verdict. */
  async finishRun(runsRoot: string, runId: string, failedStage: StageName | null) {
    const m = await finishRun(await RunStore.open(runsRoot, runId), failedStage);
    return { status: m.status, final: m.final, costUsd: m.cost.totalUsd };
  },
};

export type Activities = typeof activities;
