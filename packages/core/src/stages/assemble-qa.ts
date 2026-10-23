import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { ambienceBed, assemble, clipAudio, extractAudio, probe, voiceOverBed, OUT_H, OUT_W } from "../media.ts";
import type { AssembleOutput, MediaOutput, PlanOutput, QaCheck, QaOutput, Script } from "../schemas.ts";
import { normalizeWords, wordErrorRate } from "../util/text.ts";
import type { StageContext } from "./context.ts";

const MAX_WER = Number(process.env.REEL_MAX_WER ?? 0);

/**
 * Clips + dialogue tracks → final.mp4. In lip-sync mode the soundtrack is our verified TTS over the
 * scene's ambience, never model-generated speech; in native-audio mode it is each clip's own
 * (ASR-checked) audio.
 */
export async function assembleStage(ctx: StageContext, script: Script, plan: PlanOutput, video: MediaOutput): Promise<AssembleOutput> {
  const media = plan.shots.map((p) => video.shots.find((v) => v.shotId === p.shotId)!);
  const clips = media.map((m) => ctx.store.path(m.file));
  let tracks = plan.shots.map((p, i) => ctx.store.path(media[i]!.audio ?? p.track));
  const ambienceFrom = ctx.audio === "lipsync" ? await findAmbience(ctx, script, plan) : [];
  if (ambienceFrom.length) tracks = await withAmbience(ctx, plan, ambienceFrom);
  await assemble(clips, tracks, ctx.store.path("final.mp4"));
  const seconds = (await probe(ctx.store.path("final.mp4"))).seconds;
  await ctx.log("info", `final.mp4 assembled: ${seconds.toFixed(2)}s${ambienceFrom.length ? `, scene ambience from ${ambienceFrom.join(", ")}` : ""}`);
  return { file: "final.mp4", seconds, ambienceFrom };
}

/**
 * Lip-sync mode drops the video model's audio, because in dialogue shots it carries the model's own
 * re-voicing of the line. Shots without dialogue were prompted for ambient sound only: their audio
 * is the scene's rain, room tone and traffic. Each one is transcribed, and only audio with no words
 * in it is kept, so no model-generated speech can reach the final file.
 */
async function findAmbience(ctx: StageContext, script: Script, plan: PlanOutput): Promise<string[]> {
  await mkdir(ctx.store.path("assemble"), { recursive: true });
  const clean: string[] = [];
  for (const p of plan.shots.filter((p) => p.cues.length === 0)) {
    const raw = ctx.store.path(`video/${p.shotId}.take1.raw.mp4`);
    if (!existsSync(raw) || !(await probe(raw)).hasAudio) continue;
    const wav = ctx.store.path(`assemble/${p.shotId}.ambience.wav`);
    await clipAudio(raw, p.seconds, wav);
    const asr = await ctx.paid(`asr ambience ${p.shotId}`, 0.01, () => ctx.providers.asr.transcribe({ file: wav, language: script.language }));
    if (asr.text === null) {
      await ctx.log("info", `${p.shotId}: no ASR to prove the ambience has no speech; not used`);
    } else if (normalizeWords(asr.text).length) {
      await ctx.log("info", `${p.shotId}: model audio has words («${asr.text}»); not used as ambience`);
    } else {
      clean.push(p.shotId);
    }
  }
  return clean;
}

/** Per-shot soundtracks: clean shots keep their own ambience, every other shot gets a loop of the first clean one under its dialogue. */
async function withAmbience(ctx: StageContext, plan: PlanOutput, clean: string[]): Promise<string[]> {
  const source = ctx.store.path(`assemble/${clean[0]}.ambience.wav`);
  const out: string[] = [];
  for (const p of plan.shots) {
    if (clean.includes(p.shotId)) {
      out.push(ctx.store.path(`assemble/${p.shotId}.ambience.wav`));
      continue;
    }
    const bed = ctx.store.path(`assemble/${p.shotId}.bed.wav`);
    const mix = ctx.store.path(`assemble/${p.shotId}.mix.wav`);
    await ambienceBed(source, p.seconds, bed);
    await voiceOverBed(ctx.store.path(p.track), bed, p.seconds, mix);
    out.push(mix);
  }
  return out;
}

/** Independent checks on the finished file: the pipeline does not get to grade its own homework. */
export async function qaStage(ctx: StageContext, script: Script, plan: PlanOutput, final: AssembleOutput): Promise<QaOutput> {
  const file = ctx.store.path(final.file);
  const info = await probe(file);
  const checks: QaCheck[] = [
    { name: "duration", pass: info.seconds >= 8 && info.seconds <= 30.5, value: `${info.seconds.toFixed(2)}s`, expected: "8–30s" },
    { name: "resolution", pass: info.width === OUT_W && info.height === OUT_H, value: `${info.width}x${info.height}`, expected: `${OUT_W}x${OUT_H} (9:16)` },
    { name: "audio stream", pass: info.hasAudio, value: String(info.hasAudio), expected: "true" },
  ];

  const order = plan.shots.flatMap((p) => p.cues.map((c) => c.lineId));
  const expectedText = order.map((id) => script.lines.find((l) => l.id === id)!.text).join(" ");
  await extractAudio(file, ctx.store.path("final.wav"));
  const asr = await ctx.paid("asr final", 0.02, () =>
    ctx.providers.asr.transcribe({ file: ctx.store.path("final.wav"), language: script.language }),
  );
  let wer: number | null = null;
  if (asr.text === null) {
    checks.push({ name: "verbatim dialogue", pass: true, value: "skipped (no ASR in this preset)", expected: `WER ≤ ${MAX_WER}` });
  } else {
    wer = wordErrorRate(expectedText, asr.text);
    checks.push({ name: "verbatim dialogue", pass: wer <= MAX_WER, value: `WER ${wer.toFixed(3)}`, expected: `WER ≤ ${MAX_WER}` });
  }

  const pass = checks.every((c) => c.pass);
  for (const c of checks) await ctx.log(c.pass ? "qa.pass" : "qa.fail", `${c.name}: ${c.value} (expected ${c.expected})`);
  return { pass, checks, expectedText, heardText: asr.text, wer };
}
