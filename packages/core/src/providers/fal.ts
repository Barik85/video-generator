import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fal, ApiError, ValidationError } from "@fal-ai/client";
import { PermanentError } from "../util/retry.ts";
import type { AsrProvider, ImageProvider, TtsProvider, VideoProvider } from "./types.ts";

// Prices from the fal model pages (2026-10-20). Used for budget accounting, not billing truth.
const PRICE = {
  elevenV3PerKChar: 0.1,
  seedreamPerImage: 0.03,
  scribePerMinute: 0.03,
  seedance20FastPerSec: 0.2419, // 720p
  seedance25PerSec: 0.473, // 720p
};

const MIME: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4" };

async function upload(file: string): Promise<string> {
  const buf = await readFile(file);
  return fal.storage.upload(new Blob([buf], { type: MIME[path.extname(file)] ?? "application/octet-stream" }));
}

async function download(url: string, outFile: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  await writeFile(outFile, Buffer.from(await r.arrayBuffer()));
}

/** fal.subscribe with error classification: 4xx validation/auth errors are not worth retrying. */
async function call<T>(endpoint: string, input: Record<string, unknown>): Promise<T> {
  try {
    const res = await fal.subscribe(endpoint, { input, logs: false });
    return res.data as T;
  } catch (err) {
    if (err instanceof ValidationError) throw new PermanentError(`${endpoint}: invalid input: ${JSON.stringify(err.body)}`);
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      throw new PermanentError(`${endpoint}: ${err.status} ${err.message}`);
    }
    throw err;
  }
}

const VOICES = { female: process.env.REEL_VOICE_FEMALE ?? "Sarah", male: process.env.REEL_VOICE_MALE ?? "George" };

export class FalElevenTts implements TtsProvider {
  name = "fal:elevenlabs/tts/eleven-v3";
  async speak({ text, voice, language, outFile, attempt }: Parameters<TtsProvider["speak"]>[0]) {
    const data = await call<{ audio: { url: string } }>("fal-ai/elevenlabs/tts/eleven-v3", {
      text,
      voice: VOICES[voice],
      language_code: language,
      // A retry means the previous take was misheard: trade expressiveness for clarity.
      stability: attempt === 1 ? 0.5 : 0.8,
      apply_text_normalization: "auto",
    });
    await download(data.audio.url, outFile);
    return { usd: (text.length / 1000) * PRICE.elevenV3PerKChar };
  }
}

export class FalSeedreamImage implements ImageProvider {
  name = "fal:bytedance/seedream/v4";
  async generate({ prompt, outFile, seed }: Parameters<ImageProvider["generate"]>[0]) {
    const data = await call<{ images: Array<{ url: string }>; seed: number }>("fal-ai/bytedance/seedream/v4/text-to-image", {
      prompt,
      image_size: { width: 1440, height: 2560 },
      num_images: 1,
      seed,
    });
    const url = data.images[0]?.url;
    if (!url) throw new Error("seedream returned no image");
    await download(url, outFile);
    return { usd: PRICE.seedreamPerImage, seed: data.seed ?? null };
  }
}

export class FalSeedanceVideo implements VideoProvider {
  constructor(
    private endpoint: string,
    readonly usdPerSecond: number,
    readonly maxSeconds: number,
  ) {}
  get name() {
    return `fal:${this.endpoint}`;
  }
  minSeconds = 4;
  acceptsAudio = true;

  async generate({ prompt, imageFile, audioFile, seconds, outFile, seed }: Parameters<VideoProvider["generate"]>[0]) {
    const [imageUrl, audioUrl] = await Promise.all([upload(imageFile), audioFile ? upload(audioFile) : Promise.resolve(null)]);
    const data = await call<{ video: { url: string }; seed: number }>(this.endpoint, {
      prompt,
      image_urls: [imageUrl],
      ...(audioUrl ? { audio_urls: [audioUrl] } : {}),
      duration: String(seconds),
      aspect_ratio: "9:16",
      resolution: "720p",
      // Native audio drives lip-sync; the soundtrack itself is replaced by our verified TTS track later.
      generate_audio: true,
      ...(seed !== undefined ? { seed } : {}),
    });
    await download(data.video.url, outFile);
    return { usd: seconds * this.usdPerSecond, seed: data.seed ?? null };
  }
}

export const seedance20Fast = () => new FalSeedanceVideo("bytedance/seedance-2.0/fast/reference-to-video", PRICE.seedance20FastPerSec, 15);
export const seedance25 = () => new FalSeedanceVideo("bytedance/seedance-2.5/reference-to-video", PRICE.seedance25PerSec, 30);

const ISO3: Record<string, string> = { en: "eng", uk: "ukr", es: "spa", fr: "fra", de: "deu", pl: "pol", ja: "jpn", zh: "zho", pt: "por", it: "ita" };

export class FalScribeAsr implements AsrProvider {
  name = "fal:elevenlabs/speech-to-text";
  async transcribe({ file, language }: Parameters<AsrProvider["transcribe"]>[0]) {
    const [url, seconds] = await Promise.all([upload(file), durationOf(file)]);
    const data = await call<{ text: string }>("fal-ai/elevenlabs/speech-to-text", {
      audio_url: url,
      ...(ISO3[language] ? { language_code: ISO3[language] } : {}),
      tag_audio_events: false,
      diarize: false,
    });
    return { text: data.text, usd: Math.max(seconds / 60, 1 / 60) * PRICE.scribePerMinute };
  }
}

async function durationOf(file: string) {
  const { probe } = await import("../media.ts");
  return (await probe(file)).seconds;
}
