import { fal } from "@fal-ai/client";
import { PRESETS, type PresetName } from "../config.ts";
import { AnthropicLlm } from "./anthropic.ts";
import { FalElevenTts, FalScribeAsr, FalSeedreamImage, seedance20Fast, seedance25 } from "./fal.ts";
import { MockAsr, MockImage, MockLlm, MockTts, MockVideo } from "./mock.ts";
import { OpenRouterAsr, OpenRouterImage, OpenRouterLlm, OpenRouterTts, OpenRouterVideo } from "./openrouter.ts";
import type { Providers } from "./types.ts";

export type { Providers } from "./types.ts";

export function providersFor(presetName: string): Providers {
  if (!(presetName in PRESETS)) throw new Error(`unknown preset "${presetName}"; known: ${Object.keys(PRESETS).join(", ")}`);
  const p = PRESETS[presetName as PresetName];
  const providers = build(p);
  if (p.audio === "lipsync" && !providers.video.acceptsAudio) {
    throw new Error(`preset ${presetName}: ${providers.video.name} cannot take a reference audio track; use a native-audio preset`);
  }
  return providers;
}

/** Env keys a preset needs that are not set; empty when the preset can run here. */
export function missingKeys(presetName: PresetName): string[] {
  const p = PRESETS[presetName];
  if (p.video === "mock") return [];
  const need = p.video.startsWith("openrouter:") ? ["OPENROUTER_API_KEY"] : ["FAL_KEY", "ANTHROPIC_API_KEY"];
  return need.filter((n) => !process.env[n] && !(n === "ANTHROPIC_API_KEY" && process.env.ANTHROPIC_AUTH_TOKEN));
}

function build(p: (typeof PRESETS)[PresetName]): Providers {
  if (p.video === "mock") {
    return { llm: new MockLlm(), tts: new MockTts(), image: new MockImage(), video: new MockVideo(), asr: new MockAsr() };
  }
  if (p.video.startsWith("openrouter:")) {
    requireEnv("OPENROUTER_API_KEY");
    const id = (s: string) => s.replace(/^openrouter:/, "");
    return {
      llm: new OpenRouterLlm(id(p.llm)),
      tts: new OpenRouterTts(id(p.tts)),
      image: new OpenRouterImage(id(p.image)),
      video: new OpenRouterVideo(id(p.video)),
      asr: new OpenRouterAsr(id(p.asr)),
    };
  }
  requireEnv("FAL_KEY");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) requireEnv("ANTHROPIC_API_KEY");
  fal.config({ credentials: process.env.FAL_KEY });
  return {
    llm: new AnthropicLlm(),
    tts: new FalElevenTts(),
    image: new FalSeedreamImage(),
    video: p.video === "fal-seedance-2.5" ? seedance25() : seedance20Fast(),
    asr: new FalScribeAsr(),
  };
}

function requireEnv(...names: string[]) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`missing env: ${missing.join(", ")} (see .env.example)`);
}
