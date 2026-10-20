/**
 * Presets bundle provider choices. "mock" runs fully offline (ffmpeg + macOS `say`) so the
 * whole pipeline, its state handling and its error paths can be exercised without API keys.
 */
export const PRESETS = {
  mock: { llm: "mock", tts: "mock", image: "mock", video: "mock", asr: "mock" },
  "seedance-fast": {
    llm: "anthropic",
    tts: "fal-elevenlabs-v3",
    image: "fal-seedream-v4",
    video: "fal-seedance-2.0-fast",
    asr: "fal-elevenlabs-scribe",
  },
  "seedance-2.5": {
    llm: "anthropic",
    tts: "fal-elevenlabs-v3",
    image: "fal-seedream-v4",
    video: "fal-seedance-2.5",
    asr: "fal-elevenlabs-scribe",
  },
} as const;
export type PresetName = keyof typeof PRESETS;
export type Preset = (typeof PRESETS)[PresetName];
