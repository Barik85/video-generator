import path from "node:path";

/** <repo>/ — this file lives at <repo>/apps/api/src/env.ts */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const RUNS_ROOT = path.resolve(process.env.RUNS_DIR ?? path.join(REPO_ROOT, "runs"));

export const PORT = Number(process.env.PORT ?? 8787);

/**
 * "core" (default) — real pipeline from @reel/core.
 * "fake" — in-process simulator (src/fake/simulate.ts) that writes schema-valid run folders with
 * placeholder media, so the UI can be demoed end-to-end before the core runner lands.
 */
export const RUNNER: "core" | "fake" = process.env.REEL_RUNNER === "fake" ? "fake" : "core";
