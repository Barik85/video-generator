import path from "node:path";

/** <repo>/ — this file lives at <repo>/apps/api/src/env.ts */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const RUNS_ROOT = path.resolve(process.env.RUNS_DIR ?? path.join(REPO_ROOT, "runs"));

export const PORT = Number(process.env.PORT ?? 8787);

/**
 * "core" (default) — real pipeline from @reel/core, stages run inside the API process.
 * "temporal" — same pipeline as a Temporal workflow (@reel/temporal): TEMPORAL_ADDRESS + a separate
 *   worker, or, without TEMPORAL_ADDRESS, a dev server and worker started inside the API process.
 * "fake" — in-process simulator (src/fake/simulate.ts) that writes schema-valid run folders with
 *   placeholder media, so the UI can be demoed without spending anything.
 */
const runners = ["core", "temporal", "fake"] as const;
export const RUNNER: (typeof runners)[number] = runners.find((r) => r === process.env.REEL_RUNNER) ?? "core";
