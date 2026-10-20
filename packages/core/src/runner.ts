import type { Manifest, RunEvent, RunInput, StageName } from "./schemas.ts";

export interface RunOptions {
  /** Directory holding all run folders, e.g. ./runs */
  runsRoot: string;
  onEvent?: (e: RunEvent) => void;
}

// Contract stub — implementation in progress.
export async function startRun(_opts: RunOptions & { input: RunInput }): Promise<Manifest> {
  throw new Error("not implemented");
}

export async function resumeRun(_opts: RunOptions & { runId: string; from?: StageName }): Promise<Manifest> {
  throw new Error("not implemented");
}
