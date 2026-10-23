import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { probe, toCleanWav } from "../media.ts";
import type { Script, VoiceOutput } from "../schemas.ts";
import { PermanentError } from "../util/retry.ts";
import { wordErrorRate } from "../util/text.ts";
import type { StageContext } from "./context.ts";

const MAX_TAKES = 3;
const MAX_WER = Number(process.env.REEL_MAX_WER ?? 0);

/**
 * Text → speech, one file per line, each verified by ASR *before* any money is spent on video.
 * Catching a dropped or garbled word here costs cents; catching it after video generation costs dollars.
 */
export async function voiceStage(ctx: StageContext, script: Script): Promise<VoiceOutput> {
  await mkdir(ctx.store.path("voice"), { recursive: true });
  const prev = existsSync(ctx.store.path("voice.json")) ? await ctx.store.readJson<VoiceOutput>("voice.json") : null;
  const out: VoiceOutput = { lines: [] };

  for (const line of script.lines) {
    const rel = `voice/${line.id}.wav`;
    const done = prev?.lines.find((l) => l.lineId === line.id && l.text === line.text);
    if (done && existsSync(ctx.store.path(rel))) {
      out.lines.push(done);
      continue;
    }
    const character = script.characters.find((c) => c.id === line.characterId)!;
    const shot = script.shots.find((s) => s.lineIds.includes(line.id));
    const direction = `${character.name}, ${character.look}. Scene: ${shot?.visual ?? script.logline} Mood and style: ${script.style}.`;
    let heard: string | null = null;
    let wer = 1;
    let takes = 0;
    for (let take = 1; take <= MAX_TAKES; take++) {
      takes = take;
      const raw = ctx.store.path(`voice/${line.id}.take${take}.mp3`);
      await ctx.paid(`tts ${line.id} take ${take}`, 0.01, () =>
        ctx.providers.tts.speak({ text: line.text, voice: character.voice, language: script.language, outFile: raw, attempt: take, direction }),
      );
      await toCleanWav(raw, ctx.store.path(rel));
      const asr = await ctx.paid(`asr ${line.id} take ${take}`, 0.01, () =>
        ctx.providers.asr.transcribe({ file: ctx.store.path(rel), language: script.language }),
      );
      heard = asr.text;
      if (heard === null) {
        await ctx.log("info", `${line.id}: ASR unavailable (${ctx.providers.asr.name}), verbatim check skipped`);
        wer = 0;
        break;
      }
      wer = wordErrorRate(line.text, heard);
      if (wer <= MAX_WER) break;
      await ctx.log("qa.fail", `${line.id} take ${take}: heard «${heard}» (WER ${wer.toFixed(2)}), re-recording`, { heard, wer });
    }
    if (wer > MAX_WER) throw new PermanentError(`${line.id}: TTS not verbatim after ${MAX_TAKES} takes; last heard «${heard}»`);
    const seconds = (await probe(ctx.store.path(rel))).seconds;
    out.lines.push({ lineId: line.id, text: line.text, file: rel, seconds, asrText: heard, attempts: takes });
    await ctx.log("info", `${line.id}: ${seconds.toFixed(2)}s «${line.text}»`);
    await ctx.store.writeJson("voice.json", out); // checkpoint: a crash mid-stage keeps finished lines
  }
  return out;
}
