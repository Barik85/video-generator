/**
 * Fake pipeline used (a) by scripts/fake-runs.ts to seed demo run folders and (b) by the API when
 * REEL_RUNNER=fake, so the UI can be developed before the real runner in @reel/core lands.
 *
 * It only talks to the run through RunStore, so the folders it writes have exactly the shape the
 * real pipeline will produce (manifest.json, events.jsonl, stage JSON outputs, media files).
 */
import {
  RunStore,
  STAGES,
  type AssembleOutput,
  type Manifest,
  type MediaOutput,
  type PlanOutput,
  type QaOutput,
  type RunEvent,
  type RunInput,
  type RunOptions,
  type Script,
  type StageName,
  type VoiceOutput,
} from "@reel/core";
import { concat, keyframe, shotVideo, silence, tone } from "./media.ts";

export interface Scenario {
  script?: Script;
  /** What ASR "hears" per line id (defaults to the exact text). */
  heard?: Record<string, string>;
  /** Make this stage fail with the given error and stop the run. */
  failAt?: { stage: StageName; error: string };
  /** Leave this stage "running" and return, as if the process were still working on it. */
  stopAt?: StageName;
  /** shotId → number of rejected video attempts before the accepted one. */
  videoRetries?: Record<string, number>;
  /** Pause between steps, ms (0 for seeding, ~800 for a live demo). */
  delayMs?: number;
}

const VIDEO_RATE: Record<string, number> = {
  mock: 0,
  "mock-native": 0,
  "seedance-fast": 0.2419,
  "seedance-2.5": 0.473,
  "or-seedance-lipsync": 0.091,
  "or-seedance-native": 0.091,
  "or-veo-native": 0.05,
  "or-kling-native": 0.126,
};
const PALETTE: Array<[string, string]> = [
  ["0x1C2433", "0x7AA7FF"],
  ["0x2E1717", "0xF0A04B"],
  ["0x15291F", "0x6BD9A3"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ---------- public API (same shape as @reel/core startRun / resumeRun) ----------

/** Mirrors the core contract (main branch): onCreated fires right after the run folder exists. */
export type RunnerOptions = RunOptions & { onCreated?: (runId: string) => void };

export async function fakeStartRun(opts: RunnerOptions & { input: RunInput; scenario?: Scenario }): Promise<Manifest> {
  const store = await RunStore.create(opts.runsRoot, opts.input);
  opts.onCreated?.(store.runId);
  if (opts.onEvent) store.onEvent(opts.onEvent);
  await store.event("run", "info", `run created (fake runner, preset ${opts.input.preset})`);
  return execute(store, opts.scenario ?? { delayMs: 700 });
}

export async function fakeResumeRun(opts: RunnerOptions & { runId: string; from?: StageName }): Promise<Manifest> {
  const store = await RunStore.open(opts.runsRoot, opts.runId);
  opts.onCreated?.(store.runId);
  if (opts.onEvent) store.onEvent(opts.onEvent);
  const m = store.get();
  const from = opts.from ?? STAGES.find((s) => m.stages[s]?.status !== "done");
  if (!from) return m;
  await store.invalidateFrom(from);
  await store.event("run", "info", `resume from ${from} (fake runner)`);
  return execute(store, { delayMs: 700 });
}

// ---------- pipeline ----------

async function execute(store: RunStore, sc: Scenario): Promise<Manifest> {
  const delay = sc.delayMs ?? 0;
  const input = store.get().input;
  const rate = VIDEO_RATE[input.preset] ?? 0.2419;
  const paid = !input.preset.startsWith("mock");

  const steps: Record<StageName, () => Promise<{ out: unknown; note: string }>> = {
    script: async () => {
      const script = sc.script ?? scriptFromIdea(input);
      if (paid) await store.addCost("script", "LLM script + shot plan", 0.02);
      return { out: script, note: `${script.shots.length} shots, ${script.lines.length} lines` };
    },
    voice: async () => {
      const script = await read<Script>(store, "script");
      const lines: VoiceOutput["lines"] = [];
      for (const l of script.lines) {
        const seconds = round1(Math.max(1.2, l.text.split(/\s+/).length * 0.38));
        const file = `voice/${l.id}.wav`;
        await tone(store.path(file), seconds, 330 + lines.length * 110);
        lines.push({ lineId: l.id, text: l.text, file, seconds, asrText: sc.heard?.[l.id] ?? l.text, attempts: 1 });
        await store.event("voice", "info", `${l.id}: ${seconds}s`, { lineId: l.id, file });
        await sleep(delay / 2);
      }
      if (paid) await store.addCost("voice", "TTS", round2(0.004 * lines.length + 0.006));
      return { out: { lines }, note: `${lines.length} lines` };
    },
    plan: async () => {
      const script = await read<Script>(store, "script");
      const voice = await read<VoiceOutput>(store, "voice");
      const secs = (id: string) => voice.lines.find((v) => v.lineId === id)?.seconds ?? 2;
      const raw = script.shots.map((s) => Math.max(Math.round(s.approxSeconds), Math.ceil(s.lineIds.reduce((a, id) => a + secs(id) + 0.4, 0.6))));
      // stretch/shrink the shots so the total hits the requested length
      const sum = raw.reduce((a, b) => a + b, 0);
      const target = input.targetSeconds;
      const scaled = raw.map((r) => Math.max(2, Math.round((r * target) / sum)));
      scaled[scaled.length - 1]! += target - scaled.reduce((a, b) => a + b, 0);
      const shots: PlanOutput["shots"] = [];
      let start = 0;
      for (const [i, s] of script.shots.entries()) {
        const seconds = scaled[i]!;
        let at = 0.5;
        const cues = s.lineIds.map((lineId) => {
          const c = { lineId, at: round1(at) };
          at += secs(lineId) + 0.4;
          return c;
        });
        const track = `plan/${s.id}.wav`;
        if (cues.length) await tone(store.path(track), seconds, 330);
        else await silence(store.path(track), seconds);
        shots.push({ shotId: s.id, start, seconds, cues, track });
        start += seconds;
      }
      return { out: { shots, totalSeconds: start }, note: `${shots.length} shots, ${start}s` };
    },
    keyframes: async () => {
      const plan = await read<PlanOutput>(store, "plan");
      const shots: MediaOutput["shots"] = [];
      for (const [i, s] of plan.shots.entries()) {
        const file = `keyframes/${s.shotId}.png`;
        const [c0, c1] = PALETTE[i % PALETTE.length]!;
        await keyframe(store.path(file), c0, c1);
        shots.push({ shotId: s.shotId, file, attempts: 1, seed: 1000 + i });
        if (paid) await store.addCost("keyframes", `keyframe ${s.shotId}`, 0.04);
        await sleep(delay / 2);
      }
      return { out: { shots }, note: `${shots.length}/${plan.shots.length}` };
    },
    video: async () => {
      const plan = await read<PlanOutput>(store, "plan");
      const keys = await read<MediaOutput>(store, "keyframes");
      const shots: MediaOutput["shots"] = [];
      for (const s of plan.shots) {
        const retries = sc.videoRetries?.[s.shotId] ?? 0;
        for (let a = 1; a <= retries; a++) {
          if (paid) await store.addCost("video", `${s.shotId} attempt ${a}`, round2(s.seconds * rate));
          await store.event("video", "retry", `${s.shotId}: lip offset 240ms > 120ms, retry ${a}/2`, { shotId: s.shotId, attempt: a });
          await sleep(delay);
        }
        const file = `video/${s.shotId}.mp4`;
        const key = keys.shots.find((k) => k.shotId === s.shotId)!;
        await shotVideo(store.path(file), store.path(key.file), store.path(s.track), s.seconds);
        if (paid) await store.addCost("video", `${s.shotId} ${s.seconds}s`, round2(s.seconds * rate));
        if (sc.failAt?.stage === "video") throw new Error(sc.failAt.error);
        shots.push({ shotId: s.shotId, file, attempts: retries + 1, seed: 42 });
        await store.event("video", "info", `${s.shotId} done (${s.seconds}s, attempt ${retries + 1})`, { shotId: s.shotId, file });
        await sleep(delay);
      }
      return { out: { shots }, note: `${shots.length} clips` };
    },
    assemble: async () => {
      const video = await read<MediaOutput>(store, "video");
      const plan = await read<PlanOutput>(store, "plan");
      await concat(store.path("final.mp4"), video.shots.map((s) => store.path(s.file)));
      const out: AssembleOutput = { file: "final.mp4", seconds: plan.totalSeconds };
      return { out, note: `final.mp4 ${plan.totalSeconds}s` };
    },
    qa: async () => {
      const script = await read<Script>(store, "script");
      const voice = await read<VoiceOutput>(store, "voice");
      const plan = await read<PlanOutput>(store, "plan");
      const expectedText = script.lines.map((l) => l.text).join(" ");
      const heardText = voice.lines.map((l) => l.asrText ?? "").join(" ");
      const w = wer(expectedText, heardText);
      const checks: QaOutput["checks"] = [
        { name: "Verbatim (WER)", pass: w === 0, value: w.toFixed(2), expected: "0.00" },
        { name: "Duration 8–30 s", pass: plan.totalSeconds >= 8 && plan.totalSeconds <= 30, value: `${plan.totalSeconds} s`, expected: "8–30 s" },
        { name: "Format 9:16", pass: true, value: "360×640", expected: "9:16" },
        { name: "TTS audio track", pass: true, value: "yes", expected: "yes" },
      ];
      const out: QaOutput = { pass: checks.every((c) => c.pass), checks, expectedText, heardText, wer: w };
      if (paid) await store.addCost("qa", "ASR", 0.01);
      if (!out.pass) {
        await store.writeJson("qa.json", out);
        await store.updateStage("qa", { output: "qa.json" });
        await store.event("qa", "qa.fail", `WER ${w.toFixed(2)} > 0.00`, { wer: w });
        throw new Error(`QA failed: WER ${w.toFixed(2)}`);
      }
      return { out, note: `pass, WER ${w.toFixed(2)}` };
    },
  };

  for (const name of STAGES) {
    const rec = store.stage(name);
    if (rec.status === "done") continue;
    await store.updateStage(name, { status: "running", attempts: rec.attempts + 1, startedAt: nowIso(), finishedAt: null, error: null });
    await store.event(name, "stage.start", `${name} started`);
    if (sc.stopAt === name) return store.get();
    await sleep(delay);
    try {
      if (sc.failAt?.stage === name && name !== "video") throw new Error(sc.failAt.error);
      const { out, note } = await steps[name]();
      const rel = `${name}.json`;
      await store.writeJson(rel, out);
      await store.updateStage(name, { status: "done", finishedAt: nowIso(), output: rel });
      await store.event(name, "stage.done", note);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.updateStage(name, { status: "failed", finishedAt: nowIso(), error: msg });
      await store.event(name, "stage.fail", msg);
      await store.setStatus("failed");
      return store.get();
    }
  }
  await store.setStatus("done", "final.mp4");
  await store.event("run", "info", `done: final.mp4, $${store.get().cost.totalUsd.toFixed(2)}`);
  return store.get();
}

// ---------- helpers ----------

async function read<T>(store: RunStore, stage: StageName): Promise<T> {
  const rel = store.stage(stage).output;
  if (!rel) throw new Error(`missing output of ${stage}`);
  return store.readJson<T>(rel);
}

/** Deterministic stand-in for the LLM: quoted text in the idea becomes the (locked) line. */
export function scriptFromIdea(input: RunInput): Script {
  const quoted = input.idea.match(/[«"“]([^»"”]+)[»"”]/)?.[1]?.trim();
  const text = quoted ?? "I knew you would come back.";
  const title = input.idea.split(/[.!?]/)[0]!.split(/\s+/).slice(0, 6).join(" ");
  return {
    title,
    language: "en",
    logline: input.idea.slice(0, 160),
    style: "cinematic, rainy neon night, 35mm, shallow depth of field",
    characters: [{ id: "hero", name: "Heroine", look: "woman, 30s, red raincoat, wet dark hair", voice: "female" }],
    lines: [{ id: "l1", characterId: "hero", text }],
    shots: [
      { id: "s1", visual: "Wide establishing shot of the location, rain, neon reflections.", camera: "slow push-in, wide", characterIds: ["hero"], lineIds: [], approxSeconds: 5 },
      { id: "s2", visual: "The heroine faces the other person and speaks; head still during the line.", camera: "locked medium close-up", characterIds: ["hero"], lineIds: ["l1"], approxSeconds: 6 },
    ],
  };
}

export function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'’]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wer(expected: string, heard: string): number {
  const a = normalizeWords(expected);
  const b = normalizeWords(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? round2(d[a.length]![b.length]! / a.length) : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type { RunEvent };
