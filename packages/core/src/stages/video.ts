import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { clipAudio, extractAudio, normalizeClip, probe } from "../media.ts";
import type { MediaOutput, PlanOutput, PlannedShot, Script, Shot } from "../schemas.ts";
import { languageName, wordErrorRate } from "../util/text.ts";
import type { StageContext } from "./context.ts";

const MAX_WER = Number(process.env.REEL_MAX_WER ?? 0);
/** Native-audio mode only: how many paid takes a shot gets before we keep the best one. */
const MAX_TAKES = Number(process.env.REEL_VIDEO_TAKES ?? 3);

/**
 * Keyframe (+ dialogue track in lip-sync mode) → clip. Each shot and each take is checkpointed on
 * disk, so a failure on shot 2 never re-bills shot 1, and `resume` picks up exactly where it stopped.
 *
 * In native-audio mode the model speaks the line itself, so every take is transcribed and compared
 * with the script; a paraphrase triggers a new take. Every take is a separate budget-checked call.
 */
export async function videoStage(ctx: StageContext, script: Script, plan: PlanOutput, keyframes: MediaOutput): Promise<MediaOutput> {
  await mkdir(ctx.store.path("video"), { recursive: true });
  const out: MediaOutput = { shots: [] };
  const video = ctx.providers.video;
  const native = ctx.audio === "native";

  for (const p of plan.shots) {
    const shot = script.shots.find((s) => s.id === p.shotId)!;
    const rel = `video/${shot.id}.mp4`;
    const audioRel = native ? `video/${shot.id}.wav` : undefined;
    if (existsSync(ctx.store.path(rel)) && (!audioRel || existsSync(ctx.store.path(audioRel)))) {
      out.shots.push({ shotId: shot.id, file: rel, attempts: 0, seed: null, audio: audioRel });
      await ctx.log("info", `video ${shot.id}: already on disk from an earlier attempt, reused`);
      continue;
    }
    const keyframe = ctx.store.path(keyframes.shots.find((k) => k.shotId === shot.id)!.file);
    const hasDialogue = p.cues.length > 0;
    const expected = p.cues.map((c) => script.lines.find((l) => l.id === c.lineId)!.text).join(" ");
    const prompt = native ? nativeVideoPrompt(script, shot, p) : videoPrompt(script, shot, hasDialogue);

    let best: { raw: string; seed: number | null; wer: number | null; take: number } | null = null;
    let takes = 0;
    for (let take = 1; take <= (native && hasDialogue ? MAX_TAKES : 1); take++) {
      takes = take;
      const raw = ctx.store.path(`video/${shot.id}.take${take}.raw.mp4`);
      // A take that finished before a crash or a stage retry is already paid for: use it as is.
      const reused = existsSync(raw) && (await checkClip(raw, p.seconds, native).then(() => true, () => false));
      if (reused) await ctx.log("info", `${shot.id} take ${take}: reusing the clip from an earlier attempt`);
      const res = reused ? { usd: 0, seed: null } : await ctx.paid(`video ${shot.id} take ${take} (${p.seconds}s, ${video.name})`, p.seconds * video.usdPerSecond, async (attempt) => {
        const r = await video.generate({
          prompt,
          imageFile: keyframe,
          audioFile: !native && hasDialogue ? ctx.store.path(p.track) : null,
          seconds: p.seconds,
          outFile: raw,
          seed: ctx.seed(`video:${shot.id}:${take}:${attempt}`),
        });
        await checkClip(raw, p.seconds, native);
        return r;
      });
      if (!native || !hasDialogue) {
        best = { raw, seed: res.seed, wer: null, take };
        break;
      }

      const heardWav = ctx.store.path(`video/${shot.id}.take${take}.asr.wav`);
      await extractAudio(raw, heardWav);
      const asr = await ctx.paid(`asr ${shot.id} take ${take}`, 0.01, () => ctx.providers.asr.transcribe({ file: heardWav, language: script.language }));
      if (asr.text === null) {
        await ctx.log("info", `${shot.id}: ASR unavailable (${ctx.providers.asr.name}), spoken-line check skipped`);
        best = { raw, seed: res.seed, wer: null, take };
        break;
      }
      const wer = wordErrorRate(expected, asr.text);
      if (!best || best.wer === null || wer < best.wer) best = { raw, seed: res.seed, wer, take };
      if (wer <= MAX_WER) {
        await ctx.log("qa.pass", `${shot.id} take ${take}: spoken line verbatim (WER ${wer.toFixed(2)})`, { heard: asr.text, wer });
        break;
      }
      await ctx.log("qa.fail", `${shot.id} take ${take}: heard «${asr.text}» (WER ${wer.toFixed(2)})${take < MAX_TAKES ? ", regenerating" : ""}`, { heard: asr.text, wer });
    }

    // Out of takes without a verbatim one: keep the closest, and let the final QA report the failure.
    if (best!.wer !== null && best!.wer > MAX_WER) {
      await ctx.log("qa.fail", `${shot.id}: no verbatim take in ${takes}; keeping take ${best!.take} (WER ${best!.wer.toFixed(2)})`);
    }
    await normalizeClip(best!.raw, p.seconds, ctx.store.path(rel));
    if (audioRel) await clipAudio(best!.raw, p.seconds, ctx.store.path(audioRel));
    out.shots.push({ shotId: shot.id, file: rel, attempts: takes, seed: best!.seed, audio: audioRel, wer: best!.wer });
    await ctx.log("info", `video ${shot.id} ready (${p.seconds}s, takes ${takes})`);
  }
  return out;
}

/** A clip that is missing, empty or far too short is a failed generation: throw so it is retried. */
async function checkClip(file: string, seconds: number, native: boolean) {
  const info = await probe(file);
  if (!info.hasVideo || info.seconds < seconds - 1) throw new Error(`bad clip: video=${info.hasVideo} ${info.seconds.toFixed(1)}s (wanted ${seconds}s)`);
  if (native && !info.hasAudio) throw new Error("clip has no audio track although native audio was requested");
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

/** The model voices the line itself: the exact words go in quotes, with timing and a voice description. */
export function nativeVideoPrompt(script: Script, shot: Shot, plan: PlannedShot): string {
  const lines = plan.cues.map((c) => script.lines.find((l) => l.id === c.lineId)!);
  const who = script.characters.find((c) => c.id === lines[0]?.characterId);
  const language = languageName(script.language);
  return [
    `The first frame is the reference for the characters and setting; keep their appearance identical.`,
    `${shot.visual}. Camera: ${shot.camera}. Style: ${script.style}.`,
    who
      ? `${who.name} (${who.voice} voice) says in ${language}, clearly and at a natural pace, starting at about ${plan.cues[0]!.at.toFixed(1)}s: ` +
        lines.map((l) => `"${l.text}"`).join(" Then: ") +
        ` These exact words, once, nothing added or left out. Lips synchronized to the speech. No other voices, no narration.`
      : `No one speaks. Ambient sound only.`,
    `No on-screen text, subtitles or logos. No music.`,
  ].join(" ");
}
