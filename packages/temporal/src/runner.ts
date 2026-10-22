import { existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { Client, Connection } from "@temporalio/client";
import { DefaultLogger, NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { RunStore, type Manifest, type RunEvent, type RunInput, type RunOptions, type StageName } from "@reel/core";
import { activities } from "./activities.ts";
import { reelRun, type ReelRunArgs } from "./workflows.ts";

export const TASK_QUEUE = "reel";
export const WORKFLOWS_PATH = path.join(import.meta.dirname, "workflows.ts");

/** Starts a worker on `connection`. Activities read and write run folders, so it must see the same disk as the client. */
export async function createWorker(connection: NativeConnection, namespace = "default") {
  return Worker.create({ connection, namespace, taskQueue: TASK_QUEUE, workflowsPath: WORKFLOWS_PATH, activities });
}

interface Temporal {
  client: Client;
  /** Where the workflow runs: an external cluster, or a dev server started inside this process. */
  mode: "external" | "embedded";
  close(): Promise<void>;
}

let shared: Promise<Temporal> | null = null;

/**
 * TEMPORAL_ADDRESS set: connect to that server; a worker (`npm run temporal:worker`) must be running.
 * Unset: start a throwaway dev server and a worker inside this process, so one command still
 * produces a video. The dev server binary is downloaded on first use.
 */
export function connectTemporal(): Promise<Temporal> {
  shared ??= (async () => {
    const address = process.env.TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
    if (address) {
      const connection = await Connection.connect({ address });
      return { client: new Client({ connection, namespace }), mode: "external" as const, close: () => connection.close() };
    }
    // The CLI prints run events itself; keep the embedded worker's own logs to errors.
    Runtime.install({ logger: new DefaultLogger("ERROR") });
    const env = await TestWorkflowEnvironment.createLocal({ server: { log: { format: "pretty", level: "error" } } });
    const worker = await createWorker(env.nativeConnection);
    const running = worker.run();
    return {
      client: env.client,
      mode: "embedded" as const,
      async close() {
        worker.shutdown();
        await running;
        await env.teardown();
      },
    };
  })();
  return shared;
}

export async function closeTemporal() {
  const t = shared;
  shared = null;
  if (t) await (await t).close();
}

/** Same contract as the in-process `startRun` in @reel/core, but the stages run as a Temporal workflow. */
export async function startRun(opts: RunOptions & { input: RunInput }): Promise<Manifest> {
  const store = await RunStore.create(opts.runsRoot, opts.input);
  opts.onCreated?.(store.runId);
  return runWorkflow(opts, { runsRoot: opts.runsRoot, runId: store.runId, resume: false, from: null });
}

export async function resumeRun(opts: RunOptions & { runId: string; from?: StageName }): Promise<Manifest> {
  await RunStore.open(opts.runsRoot, opts.runId); // fail fast on a missing run
  opts.onCreated?.(opts.runId);
  return runWorkflow(opts, { runsRoot: opts.runsRoot, runId: opts.runId, resume: true, from: opts.from ?? null });
}

async function runWorkflow(opts: RunOptions, args: ReelRunArgs): Promise<Manifest> {
  const { client } = await connectTemporal();
  const stop = opts.onEvent ? followEvents(path.join(opts.runsRoot, args.runId, "events.jsonl"), opts.onEvent) : null;
  try {
    // The workflow id is the run id: Temporal then refuses a second concurrent execution of one run.
    const handle = await client.workflow.start(reelRun, { taskQueue: TASK_QUEUE, workflowId: args.runId, args: [args] });
    await handle.result();
  } finally {
    await stop?.();
  }
  return (await RunStore.open(opts.runsRoot, args.runId)).get();
}

/** The worker may be another process, so events are read back from the run's events.jsonl, from its current end. */
function followEvents(file: string, onEvent: (e: RunEvent) => void): () => Promise<void> {
  let offset = existsSync(file) ? statSync(file).size : 0;
  let buffered = "";
  const drain = async () => {
    if (!existsSync(file)) return;
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      await fh.read(buf, 0, buf.length, offset);
      offset = size;
      buffered += buf.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop()!;
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as RunEvent);
    } finally {
      await fh.close();
    }
  };
  let chain = Promise.resolve();
  const timer = setInterval(() => (chain = chain.then(drain)), 300);
  return async () => {
    clearInterval(timer);
    await chain;
    await drain();
  };
}
