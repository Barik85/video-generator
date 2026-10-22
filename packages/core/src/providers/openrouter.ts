import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ffmpeg } from "../util/exec.ts";
import { probe } from "../media.ts";
import { Script } from "../schemas.ts";
import { PermanentError } from "../util/retry.ts";
import { SCRIPT_SYSTEM, scriptUserMessage } from "./script-prompt.ts";
import type { AsrProvider, ImageProvider, LlmProvider, ScriptRequest, TtsProvider, VideoProvider } from "./types.ts";

/**
 * Everything through one OpenRouter key: LLM (chat completions), TTS (/audio/speech),
 * ASR (/audio/transcriptions), images (/images) and video (/videos, async job + polling).
 * Where a response carries `usage.cost` it is booked as-is; otherwise the list price below is used.
 */
const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

// List prices from the OpenRouter catalog (2026-10-21), used when a response has no usage.cost.
const PRICE = {
  ttsPerChar: { "elevenlabs/eleven-v3": 0.00008, "elevenlabs/eleven-multilingual-v2": 0.00008 } as Record<string, number>,
  asrPerSecond: 0.0000611,
  imageFallback: 0.04,
};

async function api(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "X-Title": "reel", ...init.headers },
  });
  if (res.ok) return res;
  const body = (await res.text()).slice(0, 600);
  const msg = `openrouter ${init.method ?? "GET"} ${path}: ${res.status} ${body}`;
  // 400 bad input, 401/403 key, 402 out of credits, 404 unknown model: retrying the same request cannot help.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentError(msg);
  throw new Error(msg);
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function dataUrl(file: string, mime: string) {
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

/**
 * OpenRouter takes images inline but audio references only as HTTPS URLs. With no bucket of our own,
 * the file goes to a throwaway host: Litterbox (unlisted, deleted after 1 h), or tmpfiles.org
 * (deleted after 60 min) when Litterbox is down.
 */
async function publicUrl(file: string, mime: string): Promise<string> {
  const blob = new Blob([await readFile(file)], { type: mime });
  const name = file.split("/").pop()!;
  const errors: string[] = [];
  for (const host of [litterbox, tmpfiles]) {
    try {
      return await host(blob, name);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`audio upload failed: ${errors.join("; ")}`);
}

async function litterbox(blob: Blob, name: string) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "1h");
  form.append("fileToUpload", blob, name);
  const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", { method: "POST", body: form });
  const url = (await res.text()).trim();
  if (!res.ok || !url.startsWith("https://")) throw new Error(`litterbox ${res.status}`);
  return url;
}

async function tmpfiles(blob: Blob, name: string) {
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: form });
  const page = ((await res.json().catch(() => ({}))) as { data?: { url?: string } }).data?.url;
  if (!res.ok || !page) throw new Error(`tmpfiles ${res.status}`);
  // The API returns a viewer page; the raw file sits behind a short-lived signed /dl/ link on that page.
  const html = await (await fetch(page)).text();
  const url = html.match(/href="(https:\/\/tmpfiles\.org\/dl\/[^"]+)"/)?.[1];
  if (!url) throw new Error("tmpfiles: no download link on the file page");
  return url;
}

// ---------- LLM ----------

export class OpenRouterLlm implements LlmProvider {
  constructor(private model: string) {}
  get name() {
    return `openrouter:${this.model}`;
  }

  async writeScript(req: ScriptRequest) {
    const res = await api(
      "/chat/completions",
      json({
        model: this.model,
        max_tokens: 16000,
        reasoning: { effort: "medium" },
        messages: [
          { role: "system", content: SCRIPT_SYSTEM },
          { role: "user", content: scriptUserMessage(req) },
        ],
        // Same schema the Anthropic provider sends, already reduced to the structured-output subset.
        response_format: { type: "json_schema", json_schema: { name: "script", strict: true, schema: betaZodOutputFormat(Script).schema } },
      }),
    );
    const data = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    const usd = data.usage?.cost ?? ((data.usage?.prompt_tokens ?? 0) * 4 + (data.usage?.completion_tokens ?? 0) * 20) / 1e6;
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new PermanentError(`LLM refused: ${choice.message.refusal}`);
    const text = choice?.message?.content;
    if (!text) throw new Error(`LLM returned no content (finish_reason=${choice?.finish_reason})`);
    const parsed = Script.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`LLM output does not match the script schema: ${parsed.error.message.slice(0, 300)}`);
    return { script: parsed.data, usd };
  }
}

// ---------- TTS ----------

const VOICES = { female: process.env.REEL_VOICE_FEMALE ?? "sarah", male: process.env.REEL_VOICE_MALE ?? "george" };

export class OpenRouterTts implements TtsProvider {
  constructor(private model: string) {}
  get name() {
    return `openrouter:${this.model}`;
  }

  async speak({ text, voice, outFile, attempt }: Parameters<TtsProvider["speak"]>[0]) {
    // A retry means the previous take was misheard: switch to the steadier multilingual model.
    const model = attempt === 1 ? this.model : "elevenlabs/eleven-multilingual-v2";
    const res = await api("/audio/speech", json({ model, input: text, voice: VOICES[voice].toLowerCase(), response_format: "mp3" }));
    await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
    return { usd: text.length * (PRICE.ttsPerChar[model] ?? 0.0001) };
  }
}

// ---------- ASR ----------

export class OpenRouterAsr implements AsrProvider {
  constructor(private model: string) {}
  get name() {
    return `openrouter:${this.model}`;
  }

  async transcribe({ file, language }: Parameters<AsrProvider["transcribe"]>[0]) {
    const form = new FormData();
    form.append("file", new Blob([await readFile(file)], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.model);
    form.append("language", language);
    const res = await api("/audio/transcriptions", { method: "POST", body: form });
    const data = (await res.json()) as { text?: string; usage?: { cost?: number; seconds?: number } };
    const seconds = data.usage?.seconds ?? (await probe(file)).seconds;
    return { text: data.text ?? "", usd: data.usage?.cost ?? seconds * PRICE.asrPerSecond };
  }
}

// ---------- Images ----------

export class OpenRouterImage implements ImageProvider {
  constructor(private model: string) {}
  get name() {
    return `openrouter:${this.model}`;
  }

  async generate({ prompt, outFile, seed }: Parameters<ImageProvider["generate"]>[0]) {
    const res = await api("/images", json({ model: this.model, prompt, aspect_ratio: "9:16", resolution: "2K", seed }));
    const data = (await res.json()) as { data?: Array<{ b64_json?: string }>; usage?: { cost?: number } };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${this.model} returned no image`);
    // Whatever the model returns (png/jpeg/webp), store a real PNG so downstream code can trust the extension.
    const tmp = `${outFile}.download`;
    await writeFile(tmp, Buffer.from(b64, "base64"));
    await ffmpeg(["-i", tmp, "-frames:v", "1", outFile]);
    return { usd: data.usage?.cost ?? PRICE.imageFallback, seed };
  }
}

// ---------- Video ----------

interface VideoModel {
  minSeconds: number;
  maxSeconds: number;
  durations?: number[];
  /** 720p, 9:16, with audio. Seedance bills tokens = w·h·24·s/1024: 720×1280 → 21 600 tokens per second. */
  usdPerSecond: number;
  /** Accepts input_references of type audio_url (OpenRouter: "BytePlus Seedance generation 2 and newer"). */
  acceptsAudio: boolean;
  seed: boolean;
  /** Provider-specific options, sent under provider.options (unknown provider keys are dropped by OpenRouter). */
  passthrough?: Record<string, unknown>;
}

// Vertex rejects image-to-video with a photoreal person in the first frame unless adults are explicitly allowed.
const VEO_OPTIONS = { personGeneration: "allow_adult" };

export const OPENROUTER_VIDEO: Record<string, VideoModel> = {
  "bytedance/seedance-2.0-fast": { minSeconds: 4, maxSeconds: 15, usdPerSecond: 21600 * 0.0000042, acceptsAudio: true, seed: true },
  "bytedance/seedance-2.0": { minSeconds: 4, maxSeconds: 15, usdPerSecond: 21600 * 0.000007, acceptsAudio: true, seed: true },
  "bytedance/seedance-2.5": { minSeconds: 4, maxSeconds: 30, usdPerSecond: 21600 * 0.0000107, acceptsAudio: true, seed: true },
  "google/veo-3.1-lite": { minSeconds: 4, maxSeconds: 8, durations: [4, 6, 8], usdPerSecond: 0.05, acceptsAudio: false, seed: true, passthrough: VEO_OPTIONS },
  "google/veo-3.1-fast": { minSeconds: 4, maxSeconds: 8, durations: [4, 6, 8], usdPerSecond: 0.1, acceptsAudio: false, seed: true, passthrough: VEO_OPTIONS },
  // Accepts 3 s but bills at least 5 s (observed: a 3 s shot cost $0.63), so never plan shorter than 5.
  "kwaivgi/kling-v3.0-std": { minSeconds: 5, maxSeconds: 15, usdPerSecond: 0.126, acceptsAudio: false, seed: false },
};

const POLL_MS = 10_000;
const JOB_TIMEOUT_MS = 30 * 60_000;

export class OpenRouterVideo implements VideoProvider {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly durations?: number[];
  readonly usdPerSecond: number;
  readonly acceptsAudio: boolean;
  private spec: VideoModel;

  constructor(private model: string) {
    const spec = OPENROUTER_VIDEO[model];
    if (!spec) throw new Error(`unknown OpenRouter video model ${model}; known: ${Object.keys(OPENROUTER_VIDEO).join(", ")}`);
    this.spec = spec;
    ({ minSeconds: this.minSeconds, maxSeconds: this.maxSeconds, durations: this.durations, usdPerSecond: this.usdPerSecond, acceptsAudio: this.acceptsAudio } = spec);
  }
  get name() {
    return `openrouter:${this.model}`;
  }

  async generate(req: Parameters<VideoProvider["generate"]>[0]) {
    const { outFile, seconds, seed } = req;
    // The job id is kept next to the output until the clip is downloaded. If this process dies
    // mid-generation (or a Temporal activity is retried), the next call waits for the same job
    // instead of submitting, and paying for, a new one.
    const jobFile = `${outFile}.job.json`;
    const pending = existsSync(jobFile) ? (JSON.parse(await readFile(jobFile, "utf8")) as { id: string; model: string }) : null;
    const id = pending?.model === this.model ? pending.id : await this.submit(req);
    if (id !== pending?.id) await writeFile(jobFile, JSON.stringify({ id, model: this.model, submittedAt: new Date().toISOString() }));
    const job = await this.wait(id, jobFile);
    const content = await api(`/videos/${id}/content?index=0`, { method: "GET" });
    await writeFile(outFile, Buffer.from(await content.arrayBuffer()));
    await rm(jobFile, { force: true });
    return { usd: job.usage?.cost ?? seconds * this.usdPerSecond, seed: seed ?? null };
  }

  private async submit({ prompt, imageFile, audioFile, seconds, seed }: Parameters<VideoProvider["generate"]>[0]): Promise<string> {
    const image = await dataUrl(await asJpeg(imageFile), "image/jpeg");
    // With a dialogue track: reference mode (@Image1 + @Audio1, Seedance 2). Without: the keyframe is the literal first frame.
    const inputs = audioFile
      ? {
          input_references: [
            { type: "image_url", image_url: { url: image } },
            { type: "audio_url", audio_url: { url: await publicUrl(await asMp3(audioFile), "audio/mpeg") } },
          ],
        }
      : { frame_images: [{ type: "image_url", image_url: { url: image }, frame_type: "first_frame" }] };

    const submit = await api(
      "/videos",
      json({
        model: this.model,
        prompt,
        duration: seconds,
        resolution: "720p",
        aspect_ratio: "9:16",
        generate_audio: true,
        ...(this.spec.seed && seed !== undefined ? { seed } : {}),
        ...(this.spec.passthrough ? { provider: { options: { "google-vertex": this.spec.passthrough, "google-ai-studio": this.spec.passthrough } } } : {}),
        ...inputs,
      }),
    );
    return ((await submit.json()) as { id: string }).id;
  }

  /**
   * Polls the job. Network blips while polling are tolerated here rather than thrown. On any throw
   * except a terminal job status the job file stays, so the next attempt keeps waiting for this job.
   */
  private async wait(id: string, jobFile: string) {
    const started = Date.now();
    let blips = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let job: { status: string; error?: string; usage?: { cost?: number | null } };
      try {
        job = (await (await api(`/videos/${id}`, { method: "GET" })).json()) as typeof job;
        blips = 0;
      } catch (err) {
        if (err instanceof PermanentError || ++blips > 6) throw err;
        continue;
      }
      if (job.status === "completed") return job;
      if (["failed", "cancelled", "expired"].includes(job.status)) {
        await rm(jobFile, { force: true }); // finished for good: a retry must submit a new job
        const msg = `${this.model} job ${id} ${job.status}: ${job.error ?? "no details"}`;
        // A moderation refusal will refuse again; anything else is worth another attempt.
        if (/moderat|policy|safety|sensitive|violat/i.test(job.error ?? "")) throw new PermanentError(msg);
        throw new Error(msg);
      }
      if (Date.now() - started > JOB_TIMEOUT_MS) {
        // Do not resubmit: the job may still finish and bill. Resume later once it is clear what happened.
        throw new PermanentError(`${this.model} job ${id} still ${job.status} after ${JOB_TIMEOUT_MS / 60_000} min`);
      }
    }
  }
}

/** Keyframes are 2K PNGs (~5 MB); inline uploads go as base64, so send a 720p JPEG instead. */
async function asJpeg(file: string) {
  const out = file.replace(/\.[^.]+$/, ".upload.jpg");
  await ffmpeg(["-i", file, "-vf", "scale=-2:1280", "-q:v", "3", out]);
  return out;
}

async function asMp3(file: string) {
  const out = file.replace(/\.[^.]+$/, ".upload.mp3");
  await ffmpeg(["-i", file, "-ac", "1", "-b:a", "128k", out]);
  return out;
}
