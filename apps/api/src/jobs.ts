/**
 * Background execution of runs.
 *
 * With REEL_RUNNER=core runs execute as in-process promises. If the API process dies, the run
 * folder stays consistent (RunStore writes atomically) and can be continued with "resume".
 * With REEL_RUNNER=temporal the API only starts a workflow and waits for it; the stages run on a
 * Temporal worker, which survives API restarts when TEMPORAL_ADDRESS points at a real server.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resumeRun, startRun, type Manifest, type RunInput, type StageName } from "@reel/core";
import { RUNNER, RUNS_ROOT } from "./env.ts";
import { fakeResumeRun, fakeStartRun, type RunnerOptions } from "./fake/simulate.ts";

const runner =
  RUNNER === "fake"
    ? { start: fakeStartRun, resume: fakeResumeRun }
    : RUNNER === "temporal"
      ? await import("@reel/temporal").then((t) => ({ start: t.startRun, resume: t.resumeRun }))
      : { start: startRun, resume: resumeRun };

/** runIds currently executing in this process */
const active = new Map<string, Promise<unknown>>();

export const isActive = (runId: string) => active.has(runId);

const RUN_ID_TIMEOUT_MS = 15_000;

async function runDirs(): Promise<Set<string>> {
  if (!existsSync(RUNS_ROOT)) return new Set();
  return new Set((await readdir(RUNS_ROOT)).filter((d) => d.startsWith("run_")));
}

// Launches are serialized only for the short window in which we learn the new runId; the runs
// themselves execute concurrently.
let launchLock: Promise<unknown> = Promise.resolve();

/**
 * Starts a run in the background and resolves with its runId as soon as the run folder exists.
 * Uses the core `onCreated` callback; for an older core without it, falls back to spotting the new
 * run_* directory (safe because launches are serialized).
 */
export function launchRun(input: RunInput): Promise<string> {
  const p = launchLock.then(() => launchRunUnlocked(input));
  launchLock = p.catch(() => undefined);
  return p;
}

async function launchRunUnlocked(input: RunInput): Promise<string> {
  const before = await runDirs();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (err: Error | null, runId?: string) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (err) reject(err);
      else resolve(runId!);
    };
    const track = (runId: string) => {
      if (!active.has(runId)) active.set(runId, job);
      done(null, runId);
    };
    const detect = async () => {
      if (settled) return;
      for (const d of await runDirs()) if (!before.has(d) && existsSync(path.join(RUNS_ROOT, d, "manifest.json"))) return track(d);
    };

    // Passed as a variable: `onCreated` is part of the core contract on main but may be missing
    // from older @reel/core typings.
    const opts: RunnerOptions & { input: RunInput } = {
      runsRoot: RUNS_ROOT,
      input,
      onCreated: track,
      onEvent: () => void detect(),
    };
    const job: Promise<Manifest | void> = runner
      .start(opts)
      .then(async (m) => {
        await detect();
        done(new Error("run finished before its id could be determined"));
        return m;
      })
      .catch(async (e: unknown) => {
        await detect();
        console.error("[run] failed:", e);
        done(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        for (const [id, j] of active) if (j === job) active.delete(id);
      });

    const started = Date.now();
    timer = setInterval(() => {
      if (Date.now() - started > RUN_ID_TIMEOUT_MS) done(new Error("timed out waiting for the run folder"));
      else void detect();
    }, 200);
  });
}

/**
 * Resumes a run in the background. Waits briefly so an immediate failure (bad stage, missing run,
 * runner not implemented) is reported to the caller instead of only to the log.
 */
export async function launchResume(runId: string, from?: StageName): Promise<void> {
  if (active.has(runId)) throw Object.assign(new Error("run is already executing"), { status: 409 });
  const opts: RunnerOptions & { runId: string; from?: StageName } = { runsRoot: RUNS_ROOT, runId, ...(from ? { from } : {}) };
  const job = runner.resume(opts).finally(() => active.delete(runId));
  active.set(runId, job);
  const early = await Promise.race([
    job.then(() => null, (e: unknown) => e),
    new Promise<"running">((r) => setTimeout(() => r("running"), 400)),
  ]);
  if (early !== "running" && early !== null) {
    console.error("[resume] failed:", early);
    throw early instanceof Error ? early : new Error(String(early));
  }
  job.catch((e) => console.error("[resume] failed:", e));
}
