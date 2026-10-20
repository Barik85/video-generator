import { assemble, extractAudio, probe, OUT_H, OUT_W } from "../media.ts";
import type { AssembleOutput, MediaOutput, PlanOutput, QaCheck, QaOutput, Script } from "../schemas.ts";
import { wordErrorRate } from "../util/text.ts";
import type { StageContext } from "./context.ts";

const MAX_WER = Number(process.env.REEL_MAX_WER ?? 0);

/** Clips + dialogue tracks → final.mp4. The soundtrack is always our TTS, never model-generated speech. */
export async function assembleStage(ctx: StageContext, plan: PlanOutput, video: MediaOutput): Promise<AssembleOutput> {
  const clips = plan.shots.map((p) => ctx.store.path(video.shots.find((v) => v.shotId === p.shotId)!.file));
  const tracks = plan.shots.map((p) => ctx.store.path(p.track));
  await assemble(clips, tracks, ctx.store.path("final.mp4"));
  const seconds = (await probe(ctx.store.path("final.mp4"))).seconds;
  await ctx.log("info", `final.mp4 assembled: ${seconds.toFixed(2)}s`);
  return { file: "final.mp4", seconds };
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
