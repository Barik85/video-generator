import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Placeholder media for fake runs. Small (360x640) so generating a run takes ~1 s. */
const W = 360;
const H = 640;

async function ffmpeg(args: string[], out: string) {
  await mkdir(path.dirname(out), { recursive: true });
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args, out]);
}

export async function tone(out: string, seconds: number, frequency: number) {
  await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}:sample_rate=44100`, "-ac", "1"], out);
}

export async function silence(out: string, seconds: number) {
  await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(seconds)], out);
}

export async function keyframe(out: string, c0: string, c1: string) {
  await ffmpeg(
    ["-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}:d=1`, "-frames:v", "1"],
    out,
  ).catch(() =>
    // older ffmpeg without the gradients source: flat colour
    ffmpeg(["-f", "lavfi", "-i", `color=c=${c0}:s=${W}x${H}`, "-frames:v", "1"], out),
  );
}

/** Still keyframe + audio track → h264/aac mp4 with a slow push-in so it visibly plays. */
export async function shotVideo(out: string, image: string, audio: string, seconds: number) {
  const fps = 24;
  const frames = Math.round(seconds * fps);
  await ffmpeg(
    [
      "-loop", "1", "-i", image, "-i", audio,
      "-vf", `scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0015,1.3)':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`,
      "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
      "-c:a", "aac", "-b:a", "64k", "-ar", "44100", "-ac", "1", "-shortest", "-movflags", "+faststart",
    ],
    out,
  );
}

export async function concat(out: string, inputs: string[]) {
  const list = `${out}.list.txt`;
  await writeFile(list, inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart"], out);
  await rm(list);
}
