/**
 * Presets bundle provider choices. "mock" runs fully offline (ffmpeg + macOS `say`) so the
 * whole pipeline, its state handling and its error paths can be exercised without API keys.
 *
 * `audio` picks how the dialogue gets into the video:
 * - "lipsync": verified TTS track → video model lip-syncs to it → the TTS track is the soundtrack.
 * - "native":  the video model speaks the line itself (line quoted in the prompt) → each shot is
 *              checked by ASR and regenerated on a mismatch → the model's own audio is the soundtrack.
 */
const OR = {
  llm: "openrouter:anthropic/claude-opus-5.5",
  tts: "openrouter:elevenlabs/eleven-v3",
  image: "openrouter:bytedance-seed/seedream-5-0-flash",
  asr: "openrouter:elevenlabs/scribe-v2",
} as const;

// Order is the order of recommendation; the UI lists presets in it. See docs/adr/0002.
export const PRESETS = {
  // Recommended: the video model speaks the line, ASR checks every take.
  "or-seedance-native": { ...OR, video: "openrouter:bytedance/seedance-2.0-fast", audio: "native" },
  "or-kling-native": { ...OR, video: "openrouter:kwaivgi/kling-v3.0-std", audio: "native" },
  "or-veo-native": { ...OR, video: "openrouter:google/veo-3.1-lite", audio: "native" },
  // Offline, for testing the pipeline.
  "mock-native": { llm: "mock", tts: "mock", image: "mock", video: "mock", asr: "mock", audio: "native" },
  mock: { llm: "mock", tts: "mock", image: "mock", video: "mock", asr: "mock", audio: "lipsync" },
  // Fallback for lines native audio cannot say verbatim (non-English, rare names). Sounds dry, voice by gender only.
  "or-seedance-lipsync": { ...OR, video: "openrouter:bytedance/seedance-2.0-fast", audio: "lipsync" },
  // Legacy: the first version, Claude direct + fal.ai (ADR 0001 moved everything to OpenRouter).
  "seedance-fast": {
    llm: "anthropic",
    tts: "fal-elevenlabs-v3",
    image: "fal-seedream-v4",
    video: "fal-seedance-2.0-fast",
    asr: "fal-elevenlabs-scribe",
    audio: "lipsync",
  },
  "seedance-2.5": {
    llm: "anthropic",
    tts: "fal-elevenlabs-v3",
    image: "fal-seedream-v4",
    video: "fal-seedance-2.5",
    asr: "fal-elevenlabs-scribe",
    audio: "lipsync",
  },
} as const;
export type PresetName = keyof typeof PRESETS;
export type Preset = (typeof PRESETS)[PresetName];
export type AudioMode = Preset["audio"];
