import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { normalizeClip, probe } from "../media.ts";
import type { MediaOutput, PlanOutput, Script, Shot } from "../schemas.ts";
import type { StageContext } from "./context.ts";

/**
 * Keyframe + per-shot dialogue track → clip. Each shot is checkpointed on disk, so a failure on
 * shot 2 never re-bills shot 1, and `resume` picks up exactly where it stopped.
 */
export async function videoStage(ctx: StageContext, script: Script, plan: PlanOutput, keyframes: MediaOutput): Promise<MediaOutput> {
  await mkdir(ctx.store.path("video"), { recursive: true });
  const out: MediaOutput = { shots: [] };
  const video = ctx.providers.video;

  for (const p of plan.shots) {
    const shot = script.shots.find((s) => s.id === p.shotId)!;
    const rel = `video/${shot.id}.mp4`;
    if (existsSync(ctx.store.path(rel))) {
      out.shots.push({ shotId: shot.id, file: rel, attempts: 0, seed: null });
      continue;
    }
    const raw = ctx.store.path(`video/${shot.id}.raw.mp4`);
    const keyframe = ctx.store.path(keyframes.shots.find((k) => k.shotId === shot.id)!.file);
    const hasDialogue = p.cues.length > 0;
    let attempts = 0;
    const res = await ctx.paid(`video ${shot.id} (${p.seconds}s, ${video.name})`, p.seconds * video.usdPerSecond, async (attempt) => {
      attempts = attempt;
      const r = await video.generate({
        prompt: videoPrompt(script, shot, hasDialogue),
        imageFile: keyframe,
        audioFile: hasDialogue ? ctx.store.path(p.track) : null,
        seconds: p.seconds,
        outFile: raw,
        seed: ctx.seed(`video:${shot.id}:${attempt}`),
      });
      // A clip that is missing, empty or far too short is a failed generation: throw so it is retried.
      const info = await probe(raw);
      if (!info.hasVideo || info.seconds < p.seconds - 1) throw new Error(`bad clip: video=${info.hasVideo} ${info.seconds.toFixed(1)}s (wanted ${p.seconds}s)`);
      return r;
    });
    await normalizeClip(raw, p.seconds, ctx.store.path(rel));
    out.shots.push({ shotId: shot.id, file: rel, attempts, seed: res.seed });
    await ctx.log("info", `video ${shot.id} ready (${p.seconds}s, attempts ${attempts})`);
  }
  return out;
}

export function videoPrompt(script: Script, shot: Shot, hasDialogue: boolean): string {
  const speaker = script.lines.find((l) => shot.lineIds.includes(l.id))?.characterId;
  const who = script.characters.find((c) => c.id === speaker);
  return [
    `@Image1 is the opening frame and the reference for the characters and setting; keep their appearance identical.`,
    `${shot.visual}. Camera: ${shot.camera}. Style: ${script.style}.`,
    hasDialogue && who
      ? `${who.name} speaks the dialogue from @Audio1: lip movements precisely synchronized to @Audio1, mouth closed during its silences. Head stays mostly still while speaking. No other speech, no narration.`
      : `No one speaks. Ambient sound only.`,
    `No on-screen text, subtitles or logos. No music.`,
  ].join(" ");
}
