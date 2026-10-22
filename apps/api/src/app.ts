import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { PIPELINE_VERSION, PRESETS, missingKeys, type PresetName, ReviewDecision, RunInput, RunStore, STAGES } from "@reel/core";
import { z } from "zod";
import { RUNNER, RUNS_ROOT } from "./env.ts";
import { isActive, launchResume, launchRun, submitReview } from "./jobs.ts";
import { CONTENT_TYPES, listFiles, readManifest, readOutputs, runDir, safeResolve } from "./run-files.ts";

export const app = new Hono();

if (process.env.NODE_ENV !== "test") app.use("/api/*", logger());

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/api/meta", (c) =>
  c.json({ pipelineVersion: PIPELINE_VERSION, runner: RUNNER, runsRoot: RUNS_ROOT, presets: Object.keys(PRESETS), missingKeys: keysReport(), stages: STAGES }),
);

/** Presets that cannot run here, with the env keys they are missing. The fake runner needs none. */
function keysReport(): Record<string, string[]> {
  if (RUNNER === "fake") return {};
  const report: Record<string, string[]> = {};
  for (const p of Object.keys(PRESETS) as PresetName[]) {
    const m = missingKeys(p);
    if (m.length) report[p] = m;
  }
  return report;
}

app.get("/api/runs", async (c) => {
  const runs = await RunStore.list(RUNS_ROOT);
  return c.json(runs.map((m) => ({ ...m, active: isActive(m.runId) })));
});

app.post("/api/runs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RunInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
  if (!(parsed.data.preset in PRESETS)) {
    return c.json({ error: `unknown preset "${parsed.data.preset}"`, presets: Object.keys(PRESETS) }, 400);
  }
  const missing = RUNNER === "fake" ? [] : missingKeys(parsed.data.preset as PresetName);
  if (missing.length) return c.json({ error: `preset ${parsed.data.preset} needs ${missing.join(", ")} in .env` }, 400);
  const runId = await launchRun(parsed.data);
  return c.json({ runId }, 202);
});

app.get("/api/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const manifest = await readManifest(runId);
  if (!manifest) return c.json({ error: "run not found" }, 404);
  const { outputs, outputErrors } = await readOutputs(runId, manifest);
  return c.json({ manifest, outputs, outputErrors, files: await listFiles(runId), active: isActive(runId) });
});

const ResumeBody = z.object({ from: z.enum(STAGES).optional() });

app.post("/api/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  if (!(await readManifest(runId))) return c.json({ error: "run not found" }, 404);
  const parsed = ResumeBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  try {
    await launchResume(runId, parsed.data.from);
  } catch (e) {
    const status = (e as { status?: number }).status === 409 ? 409 : 500;
    return c.json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
  return c.json({ runId }, 202);
});

app.post("/api/runs/:id/review", async (c) => {
  const runId = c.req.param("id");
  const manifest = await readManifest(runId);
  if (!manifest) return c.json({ error: "run not found" }, 404);
  const parsed = ReviewDecision.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  if (manifest.awaitingReview?.gate !== parsed.data.gate) return c.json({ error: `run is not waiting for review of ${parsed.data.gate}` }, 409);
  if (parsed.data.action === "redo" && !parsed.data.note?.trim()) return c.json({ error: "a redo needs a note saying what to change" }, 400);
  try {
    await submitReview(runId, parsed.data);
  } catch (e) {
    const status = (e as { status?: number }).status === 409 ? 409 : 500;
    return c.json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
  return c.json({ runId }, 202);
});

/**
 * SSE: replays events.jsonl, then tails it (polling) until the manifest is done/failed and no job
 * for the run is executing in this process. Each message id is the byte offset after that line, so
 * a reconnecting EventSource (Last-Event-ID) continues without duplicates.
 * Messages: `event: run` (data = one RunEvent JSON), `event: end` (data = {status}).
 */
app.get("/api/runs/:id/events", async (c) => {
  const runId = c.req.param("id");
  const dir = runDir(runId);
  if (!dir || !(await readManifest(runId))) return c.json({ error: "run not found" }, 404);
  const file = path.join(dir, "events.jsonl");
  let offset = Number(c.req.header("last-event-id") ?? c.req.query("offset") ?? 0) || 0;

  return streamSSE(c, async (stream) => {
    let lastPing = Date.now();
    while (!stream.aborted) {
      const chunk = await readFrom(file, offset);
      let consumed = 0;
      for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, consumed)) {
        const line = chunk.subarray(consumed, nl).toString("utf8").trim();
        consumed = nl + 1;
        if (line) await stream.writeSSE({ event: "run", data: line, id: String(offset + consumed) });
      }
      offset += consumed;

      const m = await readManifest(runId);
      if (consumed === 0 && m && m.status !== "running" && !isActive(runId)) {
        await stream.writeSSE({ event: "end", data: JSON.stringify({ status: m.status }) });
        break;
      }
      if (Date.now() - lastPing > 15_000) {
        await stream.write(": ping\n\n");
        lastPing = Date.now();
      }
      await stream.sleep(consumed ? 50 : 500);
    }
  });
});

async function readFrom(file: string, offset: number): Promise<Buffer> {
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      if (size <= offset) return Buffer.alloc(0);
      const buf = Buffer.alloc(size - offset);
      await fh.read(buf, 0, buf.length, offset);
      return buf;
    } finally {
      await fh.close();
    }
  } catch {
    return Buffer.alloc(0); // not created yet
  }
}

/** Artifact files, with traversal protection and HTTP Range support (video seeking). */
app.get("/api/runs/:id/files/*", async (c) => {
  const runId = c.req.param("id");
  const dir = runDir(runId);
  if (!dir) return c.json({ error: "run not found" }, 404);
  const prefix = `/api/runs/${runId}/files/`;
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path.slice(prefix.length));
  } catch {
    return c.json({ error: "bad path" }, 400);
  }
  const file = await safeResolve(dir, rel);
  if (!file) return c.json({ error: "file not found" }, 404);
  const st = await stat(file);
  if (!st.isFile()) return c.json({ error: "file not found" }, 404);

  const size = st.size;
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Last-Modified": st.mtime.toUTCString(),
  };
  if (c.req.query("download") !== undefined) {
    headers["Content-Disposition"] = `attachment; filename="${runId}-${path.basename(file)}"`;
  }

  const range = c.req.header("range");
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(toWeb(file), { status: 200, headers });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = NaN;
  let end = NaN;
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
  }
  if (!Number.isFinite(start) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  return new Response(toWeb(file, start, end), { status: 206, headers });
});

const toWeb = (file: string, start?: number, end?: number) =>
  Readable.toWeb(createReadStream(file, start === undefined ? {} : { start, end })) as ReadableStream;
