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
}

export interface LlmProvider {
  name: string;
  writeScript(req: ScriptRequest): Promise<Paid & { script: Script }>;
}

export interface TtsProvider {
  name: string;
  /** Writes raw audio (any format ffmpeg reads) to outFile. `attempt` lets providers vary settings on retry. */
  speak(req: { text: string; voice: "female" | "male"; language: string; outFile: string; attempt: number }): Promise<Paid>;
}

export interface ImageProvider {
  name: string;
  generate(req: { prompt: string; outFile: string; seed: number }): Promise<Paid & { seed: number | null }>;
}

export interface VideoProvider {
  name: string;
  minSeconds: number;
  maxSeconds: number;
  /** Price per output second, used for pre-flight budget checks. */
  usdPerSecond: number;
  generate(req: {
    prompt: string;
    imageFile: string;
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
