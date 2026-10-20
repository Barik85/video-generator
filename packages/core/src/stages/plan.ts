import { mkdir } from "node:fs/promises";
import { buildShotTrack } from "../media.ts";
import type { PlanOutput, PlannedShot, Script, VoiceOutput } from "../schemas.ts";
import { PermanentError } from "../util/retry.ts";
import type { StageContext } from "./context.ts";

const LEAD_IN = 0.6; // s before the first line in a shot
const GAP = 0.4; // s between lines
const TAIL = 0.8; // s after the last line
const MIN_TOTAL = 8;
const MAX_TOTAL = 30;

/**
 * Deterministic timing: shot lengths come from the *measured* audio, not from the LLM's guess.
 * Video models take whole seconds, so every shot is rounded up and lines are cued inside it.
 */
export async function planStage(ctx: StageContext, script: Script, voice: VoiceOutput): Promise<PlanOutput> {
  const { minSeconds, maxSeconds } = ctx.providers.video;
  const dur = new Map(voice.lines.map((l) => [l.lineId, l]));

  const sized = script.shots.map((shot) => {
    const lines = shot.lineIds.map((id) => dur.get(id)!);
    const speech = lines.reduce((s, l) => s + l.seconds, 0) + GAP * Math.max(0, lines.length - 1);
    const needed = lines.length ? LEAD_IN + speech + TAIL : 0;
    const seconds = Math.ceil(Math.max(needed, shot.approxSeconds, minSeconds));
    if (needed > maxSeconds) {
      throw new PermanentError(`shot ${shot.id} needs ${needed.toFixed(1)}s of dialogue; the video model allows ${maxSeconds}s per shot`);
    }
    return { shot, lines, seconds: Math.min(seconds, maxSeconds), needed };
  });

  // Fit the total into [max(8, target ± a bit), 30] by stretching/shrinking silent room, never dialogue.
  const target = Math.min(Math.max(ctx.input.targetSeconds, MIN_TOTAL), MAX_TOTAL);
  let total = sized.reduce((s, x) => s + x.seconds, 0);
  while (total < target) {
    const grow = sized.filter((x) => x.seconds < maxSeconds).sort((a, b) => a.seconds - b.seconds)[0];
    if (!grow) break;
    grow.seconds++;
    total++;
  }
  while (total > target) {
    const shrink = sized
      .filter((x) => x.seconds - 1 >= Math.max(minSeconds, Math.ceil(x.needed)))
      .sort((a, b) => b.seconds - a.seconds)[0];
    if (!shrink) break;
    shrink.seconds--;
    total--;
  }
  if (total < MIN_TOTAL || total > MAX_TOTAL) throw new PermanentError(`planned length ${total}s outside ${MIN_TOTAL}–${MAX_TOTAL}s`);

  await mkdir(ctx.store.path("plan"), { recursive: true });
  const shots: PlannedShot[] = [];
  let start = 0;
  for (const { shot, lines, seconds } of sized) {
    const speech = lines.reduce((s, l) => s + l.seconds, 0) + GAP * Math.max(0, lines.length - 1);
    // centre dialogue in the shot, but never earlier than the lead-in
    let at = Math.max(LEAD_IN, (seconds - speech) / 2 - 0.2);
    const cues = lines.map((l) => {
      const cue = { lineId: l.lineId, at: round(at) };
      at += l.seconds + GAP;
      return cue;
    });
    const track = `plan/${shot.id}.wav`;
    await buildShotTrack(
      cues.map((c) => ({ file: ctx.store.path(dur.get(c.lineId)!.file), at: c.at })),
      seconds,
      ctx.store.path(track),
    );
    shots.push({ shotId: shot.id, start, seconds, cues, track });
    start += seconds;
  }
  await ctx.log("info", `plan: ${shots.map((s) => `${s.shotId}=${s.seconds}s`).join(", ")} → ${total}s`);
  return { shots, totalSeconds: total };
}

const round = (n: number) => Math.round(n * 100) / 100;
