import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenRouterVideo } from "./providers/openrouter.ts";

const MODEL = "bytedance/seedance-2.0-fast";

/** Stubs fetch with a pending job `job-1` that ends in `status`, and records every request. */
function stubOpenRouter(status: "completed" | "failed") {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url.replace("https://openrouter.ai/api/v1", "")}`);
    if (url.endsWith("/videos/job-1")) return Response.json({ status, usage: { cost: 0.37 }, error: status === "failed" ? "provider error" : undefined });
    if (url.endsWith("/videos/job-1/content?index=0")) return new Response("clip-bytes");
    return new Response("unexpected", { status: 500 });
  });
  return calls;
}

async function pendingJob() {
  const dir = await mkdtemp(path.join(tmpdir(), "reel-or-"));
  const outFile = path.join(dir, "s1.take1.raw.mp4");
  await writeFile(`${outFile}.job.json`, JSON.stringify({ id: "job-1", model: MODEL }));
  return outFile;
}

/** Fake only setTimeout (the 10 s poll interval); file reads stay real, so keep ticking until the call settles. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const tracked = p.finally(() => (done = true));
  tracked.catch(() => {});
  for (let i = 0; i < 20 && !done; i++) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return tracked;
}

const generate = (outFile: string) =>
  new OpenRouterVideo(MODEL).generate({ prompt: "p", imageFile: "unused.png", audioFile: null, seconds: 4, outFile });

describe("OpenRouterVideo job resume", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for a job saved by an earlier attempt instead of submitting a new one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = stubOpenRouter("completed");
    const outFile = await pendingJob();
    expect(await settle(generate(outFile))).toEqual({ usd: 0.37, seed: null });
    expect(calls).toEqual(["GET /videos/job-1", "GET /videos/job-1/content?index=0"]);
    expect(await readFile(outFile, "utf8")).toBe("clip-bytes");
    expect(existsSync(`${outFile}.job.json`)).toBe(false);
  });

  it("forgets a job that failed, so the next attempt submits a new one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    stubOpenRouter("failed");
    const outFile = await pendingJob();
    await expect(settle(generate(outFile))).rejects.toThrow(/job-1 failed/);
    expect(existsSync(`${outFile}.job.json`)).toBe(false);
  });
});
