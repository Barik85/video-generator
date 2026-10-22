/**
 * Price table for the pre-run cost estimate (the only place prices live in the UI).
 * Sources: fal.ai model pages and the OpenRouter video catalog (720p, 9:16, with audio), Oct 2026.
 */
export const FIXED_COSTS = {
  script: 0.02, // LLM script + shot plan
  voice: 0.01, // TTS of all lines
  keyframes: 0.08, // 2 keyframes
  qa: 0.01, // ASR + sync checks
} as const;

export interface VideoModel {
  name: string;
  /** How lip-sync is achieved */
  how: string;
  /** USD per output second */
  rate: number;
  /** Flat per-run extra (e.g. separate lip-sync pass) */
  extra: number;
  price: string;
  step: string;
  /** false → runs offline, nothing is billed */
  paid: boolean;
}

export const VIDEO_MODELS: Record<string, VideoModel> = {
  mock: {
    name: "Mock (offline)",
    how: "ffmpeg + macOS say, no API keys",
    rate: 0,
    extra: 0,
    price: "$0 · for testing the pipeline",
    step: "Mock: still frames + TTS track (ffmpeg)",
    paid: false,
  },
  "seedance-fast": {
    name: "Seedance 2.0 Fast",
    how: "Lips follow our audio (@Audio1)",
    rate: 0.2419,
    extra: 0,
    price: "$0.24/s · 720p",
    step: "Seedance: video lip-synced to the TTS track",
    paid: true,
  },
  "seedance-2.5": {
    name: "Seedance 2.5",
    how: "Higher quality, same lip-sync to TTS",
    rate: 0.473,
    extra: 0,
    price: "$0.47/s · 720p",
    step: "Seedance 2.5: video lip-synced to the TTS track",
    paid: true,
  },
  "mock-native": {
    name: "Mock, native audio",
    how: "Offline stand-in for a model that speaks the line itself",
    rate: 0,
    extra: 0,
    price: "$0 · for testing the pipeline",
    step: "Mock: frames + \"model\" voice (macOS say)",
    paid: false,
  },
  "or-seedance-lipsync": {
    name: "Seedance 2.0 Fast · OpenRouter",
    how: "Lips follow our TTS audio (@Audio1)",
    rate: 0.091,
    extra: 0,
    price: "~$0.09/s · 720p",
    step: "Seedance (OpenRouter): lip-sync to the TTS track",
    paid: true,
  },
  "or-seedance-native": {
    name: "Seedance 2.0 Fast · native audio",
    how: "The model speaks the line itself, ASR checks it is verbatim",
    rate: 0.091,
    extra: 0,
    price: "~$0.09/s · 720p",
    step: "Seedance (OpenRouter): video with voice + ASR check",
    paid: true,
  },
  "or-veo-native": {
    name: "Veo 3.1 Lite · native audio",
    how: "The model speaks the line itself; shots of 4/6/8 s",
    rate: 0.05,
    extra: 0,
    price: "$0.05/s · 720p",
    step: "Veo (OpenRouter): video with voice + ASR check",
    paid: true,
  },
  "or-kling-native": {
    name: "Kling v3 Std · native audio",
    how: "The model speaks the line itself, ASR checks it is verbatim",
    rate: 0.126,
    extra: 0,
    price: "$0.13/s · 720p",
    step: "Kling (OpenRouter): video with voice + ASR check",
    paid: true,
  },
};

export function modelFor(preset: string): VideoModel {
  return (
    VIDEO_MODELS[preset] ?? {
      name: preset,
      how: "unknown preset",
      rate: 0.2419,
      extra: 0,
      price: "price unknown",
      step: `${preset}: video generation`,
      paid: true,
    }
  );
}

export interface Estimate {
  lines: Array<{ label: string; usd: number }>;
  video: number;
  total: number;
  /** With two full video retries */
  worst: number;
}

/** Same formula as the design: fixed stages + seconds × rate (+ extra); worst = total + 2 × video. */
export function estimate(preset: string, seconds: number): Estimate {
  const m = modelFor(preset);
  const k = m.paid ? 1 : 0;
  const video = seconds * m.rate + m.extra;
  const lines = [
    { label: "Script + shot plan (LLM)", usd: FIXED_COSTS.script * k },
    { label: "Voice (TTS)", usd: FIXED_COSTS.voice * k },
    { label: "Keyframes (2)", usd: FIXED_COSTS.keyframes * k },
    { label: `Video ${seconds} s · ${m.name}`, usd: video },
    { label: "QA (ASR + sync)", usd: FIXED_COSTS.qa * k },
  ];
  const total = lines.reduce((a, l) => a + l.usd, 0);
  return { lines, video, total, worst: total + 2 * video };
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
