import { existsSync } from "node:fs";
import { run, ffmpeg } from "../util/exec.ts";
import { mockImage, mockVideoFromImage } from "../media.ts";
import type { Script } from "../schemas.ts";
import type { AsrProvider, ImageProvider, LlmProvider, ScriptRequest, TtsProvider, VideoProvider } from "./types.ts";

/**
 * Offline providers. They exercise the real orchestration, state, media assembly and QA code
 * paths; only the "intelligence" is faked. Set REEL_MOCK_FAIL=video:1 to inject a transient
 * failure on the first video call (to demo retries), and REEL_MOCK_VIDEO_MS=20000 to make each clip
 * take that long, like a real provider (to demo killing a worker mid-stage).
 */
const failPlan = new Map(
  (process.env.REEL_MOCK_FAIL ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => s.split(":") as [string, string]),
);
const calls = new Map<string, number>();
function maybeFail(kind: string) {
  const n = (calls.get(kind) ?? 0) + 1;
  calls.set(kind, n);
  if (Number(failPlan.get(kind) ?? 0) >= n) throw new Error(`mock transient failure (${kind} call ${n})`);
}

export class MockLlm implements LlmProvider {
  name = "mock:llm";
  async writeScript(req: ScriptRequest) {
    const lines = req.quotedLines.length ? req.quotedLines : [firstSentence(req.idea)];
    const script: Script = {
      title: firstSentence(req.idea).slice(0, 40),
      language: "en",
      logline: req.idea,
      style: "cinematic, moody, shallow depth of field",
      characters: [{ id: "hero", name: "Hero", look: "woman in her 30s, red raincoat, dark wet hair", voice: "female" }],
      lines: lines.map((text, i) => ({ id: `l${i + 1}`, characterId: "hero", text })),
      shots: [
        { id: "s1", visual: "Establishing shot of the setting", camera: "slow push-in, wide", characterIds: ["hero"], lineIds: [], approxSeconds: 4 },
        { id: "s2", visual: "The hero speaks", camera: "locked medium close-up", characterIds: ["hero"], lineIds: lines.map((_, i) => `l${i + 1}`), approxSeconds: 6 },
      ],
    };
    return { script, usd: 0 };
  }
}

export class MockTts implements TtsProvider {
  name = existsSync("/usr/bin/say") ? "mock:macos-say" : "mock:tone";
  async speak({ text, language, outFile }: Parameters<TtsProvider["speak"]>[0]) {
    maybeFail("tts");
    if (existsSync("/usr/bin/say")) {
      const voice = language === "uk" ? "Lesya" : "Samantha";
      const aiff = outFile.replace(/\.[^.]+$/, ".aiff");
      try {
        await run("say", ["-v", voice, "-o", aiff, text]);
      } catch {
        await run("say", ["-o", aiff, text]); // voice not installed: system default
      }
      await ffmpeg(["-i", aiff, outFile]);
    } else {
      const secs = Math.max(1, text.split(/\s+/).length / 2.5);
      await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=220:duration=${secs}`, outFile]);
    }
    return { usd: 0 };
  }
}

export class MockImage implements ImageProvider {
  name = "mock:gradient";
  async generate({ outFile, seed }: Parameters<ImageProvider["generate"]>[0]) {
    await mockImage(outFile, seed);
    return { usd: 0, seed };
  }
}

export class MockVideo implements VideoProvider {
  name = "mock:zoompan";
  minSeconds = 4;
  maxSeconds = 15;
  acceptsAudio = true;
  usdPerSecond = 0;
  async generate({ prompt, imageFile, audioFile, seconds, outFile }: Parameters<VideoProvider["generate"]>[0]) {
    maybeFail("video");
    await new Promise((r) => setTimeout(r, Number(process.env.REEL_MOCK_VIDEO_MS ?? 0)));
    if (audioFile) {
      await mockVideoFromImage(imageFile, seconds, outFile);
      return { usd: 0, seed: null };
    }
    // Native-audio stand-in: "speak" the quoted words from the prompt, like a real model would.
    const silent = `${outFile}.silent.mp4`;
    await mockVideoFromImage(imageFile, seconds, silent);
    const said = [...prompt.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ");
    const voice = `${outFile}.voice.mp3`;
    if (said) await new MockTts().speak({ text: said, voice: "female", language: "en", outFile: voice, attempt: 1 });
    const audioIn = said ? ["-i", voice] : ["-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${seconds}`];
    await ffmpeg(["-i", silent, ...audioIn, "-af", "adelay=800:all=1,apad", "-t", String(seconds), "-c:v", "copy", "-c:a", "aac", outFile]);
    return { usd: 0, seed: null };
  }
}

export class MockAsr implements AsrProvider {
  name = "mock:asr(no-op)";
  async transcribe() {
    return { text: null, usd: 0 };
  }
}

function firstSentence(s: string) {
  return (s.split(/(?<=[.!?…])\s/)[0] ?? s).trim();
}
