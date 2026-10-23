import type { Script } from "../schemas.ts";

/** Every provider call reports what it cost so the runner can enforce the budget. */
export interface Paid {
  usd: number;
}

export interface ScriptRequest {
  idea: string;
  targetSeconds: number;
  quotedLines: string[];
  /** Validation errors from the previous attempt, fed back to the model. */
  feedback?: string[];
  /** A human sent the script back: the script they saw and their notes, oldest first. */
  review?: { previous: Script | null; notes: string[] };
}

export interface LlmProvider {
  name: string;
  writeScript(req: ScriptRequest): Promise<Paid & { script: Script }>;
}

export interface TtsProvider {
  name: string;
  /** Writes raw audio (any format ffmpeg reads) to outFile. `attempt` lets providers vary settings on retry. */
  speak(req: {
    text: string;
    voice: "female" | "male";
    language: string;
    outFile: string;
    attempt: number;
    /** Who says it and in what scene; providers that can act use it, the others ignore it. */
    direction?: string;
  }): Promise<Paid>;
}

export interface ImageProvider {
  name: string;
  generate(req: { prompt: string; outFile: string; seed: number }): Promise<Paid & { seed: number | null }>;
}

export interface VideoProvider {
  name: string;
  minSeconds: number;
  maxSeconds: number;
  /** Set when the model accepts only specific lengths (e.g. Veo: 4, 6, 8); otherwise any whole second in [min, max]. */
  durations?: readonly number[];
  /** Whether the model takes a reference audio track (lip-sync to our TTS). Native-audio-only models do not. */
  acceptsAudio: boolean;
  /** Price per output second, used for pre-flight budget checks. */
  usdPerSecond: number;
  generate(req: {
    prompt: string;
    imageFile: string;
    /** Dialogue track to lip-sync to. Null means the model makes its own sound (silent shot or native-audio mode). */
    audioFile: string | null;
    seconds: number;
    outFile: string;
    seed?: number;
  }): Promise<Paid & { seed: number | null }>;
}

export interface AsrProvider {
  name: string;
  /** Returns null when this provider cannot actually listen (mock). */
  transcribe(req: { file: string; language: string }): Promise<Paid & { text: string | null }>;
}

export interface Providers {
  llm: LlmProvider;
  tts: TtsProvider;
  image: ImageProvider;
  video: VideoProvider;
  asr: AsrProvider;
}
