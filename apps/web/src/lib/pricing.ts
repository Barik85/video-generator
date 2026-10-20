/**
 * Price table for the pre-run cost estimate (the only place prices live in the UI).
 * Sources: docs/research/facts.md (fal.ai, Oct 2026). Seedance 2.5 has no public price yet —
 * Seedance 2.0 Standard (~$0.30/s) is used as the estimate.
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
    name: "Mock (офлайн)",
    how: "ffmpeg + macOS say, без API-ключів",
    rate: 0,
    extra: 0,
    price: "$0 · для перевірки пайплайна",
    step: "Mock: статичні кадри + TTS-доріжка (ffmpeg)",
    paid: false,
  },
  "seedance-fast": {
    name: "Seedance 2.0 Fast",
    how: "Губи під наше аудіо (@Audio1)",
    rate: 0.2419,
    extra: 0,
    price: "$0.24/с · 720p",
    step: "Seedance: відео з lip-sync під TTS-доріжку",
    paid: true,
  },
  "seedance-2.5": {
    name: "Seedance 2.5",
    how: "Вища якість, той самий lip-sync під TTS",
    rate: 0.3,
    extra: 0,
    price: "~$0.30/с · 720p (оцінка)",
    step: "Seedance 2.5: відео з lip-sync під TTS-доріжку",
    paid: true,
  },
};

export function modelFor(preset: string): VideoModel {
  return (
    VIDEO_MODELS[preset] ?? {
      name: preset,
      how: "невідомий пресет",
      rate: 0.2419,
      extra: 0,
      price: "ціна невідома",
      step: `${preset}: генерація відео`,
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
    { label: "Сценарій + shot plan (LLM)", usd: FIXED_COSTS.script * k },
    { label: "Озвучка (TTS)", usd: FIXED_COSTS.voice * k },
    { label: "Ключові кадри (2)", usd: FIXED_COSTS.keyframes * k },
    { label: `Відео ${seconds} с · ${m.name}`, usd: video },
    { label: "QA (ASR + sync)", usd: FIXED_COSTS.qa * k },
  ];
  const total = lines.reduce((a, l) => a + l.usd, 0);
  return { lines, video, total, worst: total + 2 * video };
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
