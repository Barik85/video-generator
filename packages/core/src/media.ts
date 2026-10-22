import { run, ffmpeg } from "./util/exec.ts";

export const OUT_W = 720;
export const OUT_H = 1280;
export const FPS = 24;
const SR = 48000;

export interface Probe {
  seconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; width?: number; height?: number }> };
  const v = j.streams?.find((s) => s.codec_type === "video");
  return {
    seconds: Number(j.format?.duration ?? 0),
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasVideo: !!v,
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** Any audio → mono 48 kHz PCM wav, with leading/trailing silence trimmed (TTS engines pad unpredictably). */
export async function toCleanWav(input: string, output: string) {
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05";
  await ffmpeg(["-i", input, "-af", `${trim},areverse,${trim},areverse`, "-ac", "1", "-ar", String(SR), output]);
}

/**
 * Builds a dialogue track of exactly `seconds`: silence with each line placed at its cue.
 * The same file is (a) sent to the video model as the lip-sync reference and (b) used as the
 * final soundtrack — so what is heard is always the verified TTS, never model-generated speech.
 */
export async function buildShotTrack(cues: Array<{ file: string; at: number }>, seconds: number, output: string) {
  const inputs = cues.flatMap((c) => ["-i", c.file]);
  const base = `anullsrc=r=${SR}:cl=mono:d=${seconds}`;
  if (cues.length === 0) {
    await ffmpeg(["-f", "lavfi", "-i", base, "-t", String(seconds), output]);
    return;
  }
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}:all=1[d${i}]`);
  const mixIn = ["[0:a]", ...cues.map((_, i) => `[d${i}]`)].join("");
  const filter = [...delays, `${mixIn}amix=inputs=${cues.length + 1}:normalize=0:duration=first[out]`].join(";");
  await ffmpeg(["-f", "lavfi", "-i", base, ...inputs, "-filter_complex", filter, "-map", "[out]", "-t", String(seconds), "-ar", String(SR), output]);
}

/** Normalizes a model clip to 720x1280@24, exact duration, no audio (we attach our own track). */
export async function normalizeClip(input: string, seconds: number, output: string) {
  const vf = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},fps=${FPS},tpad=stop_mode=clone:stop_duration=2,setsar=1`;
  await ffmpeg(["-i", input, "-vf", vf, "-t", String(seconds), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", output]);
}

/** Concatenates normalized clips and lays the concatenated dialogue tracks under them. */
export async function assemble(clips: string[], tracks: string[], output: string) {
  const inputs = [...clips, ...tracks].flatMap((f) => ["-i", f]);
  const n = clips.length;
  const v = clips.map((_, i) => `[${i}:v]`).join("") + `concat=n=${n}:v=1:a=0[v]`;
  const a = tracks.map((_, i) => `[${n + i}:a]`).join("") + `concat=n=${n}:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  await ffmpeg([
    ...inputs,
    "-filter_complex", `${v};${a}`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", "-ar", String(SR),
    "-movflags", "+faststart",
    output,
  ]);
}

/** The model's own soundtrack of a clip, cut/padded to exactly `seconds` (native-audio mode). */
export async function clipAudio(input: string, seconds: number, output: string) {
  await ffmpeg(["-i", input, "-vn", "-af", "apad", "-t", String(seconds), "-ac", "1", "-ar", String(SR), output]);
}

export async function extractAudio(input: string, output: string) {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", output]);
}

// ---- offline stand-ins used by the mock preset ----

export async function mockImage(output: string, seed: number) {
  const c = ["0x1d2b53", "0x7e2553", "0x008751", "0xab5236", "0x5f574f"];
  const c0 = c[seed % c.length]!;
  const c1 = c[(seed + 2) % c.length]!;
  await ffmpeg(["-f", "lavfi", "-i", `gradients=s=${OUT_W}x${OUT_H}:c0=${c0}:c1=${c1}:seed=${seed}`, "-frames:v", "1", output]);
}

export async function mockVideoFromImage(image: string, seconds: number, output: string) {
  const frames = Math.round(seconds * FPS);
  const vf = `zoompan=z='min(zoom+0.0012,1.25)':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`;
  await ffmpeg(["-loop", "1", "-i", image, "-vf", vf, "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
}
