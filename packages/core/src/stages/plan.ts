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
  const { minSeconds, maxSeconds, durations } = ctx.providers.video;
  // Lengths the model accepts: a fixed list (Veo: 4/6/8) or every whole second in [min, max].
  const allowed = durations ? [...durations].sort((a, b) => a - b) : Array.from({ length: maxSeconds - minSeconds + 1 }, (_, i) => minSeconds + i);
  const fit = (s: number) => allowed.find((d) => d >= s);
  const dur = new Map(voice.lines.map((l) => [l.lineId, l]));

  const sized = script.shots.map((shot) => {
    const lines = shot.lineIds.map((id) => dur.get(id)!);
    const speech = lines.reduce((s, l) => s + l.seconds, 0) + GAP * Math.max(0, lines.length - 1);
    const needed = lines.length ? LEAD_IN + speech + TAIL : 0;
    if (needed > maxSeconds) {
      throw new PermanentError(`shot ${shot.id} needs ${needed.toFixed(1)}s of dialogue; the video model allows ${maxSeconds}s per shot`);
    }
    const seconds = fit(Math.max(needed, shot.approxSeconds)) ?? maxSeconds;
    return { shot, lines, seconds, needed };
  });

  // Fit the total into [max(8, target ± a bit), 30] by stretching/shrinking silent room, never dialogue.
  const target = Math.min(Math.max(ctx.input.targetSeconds, MIN_TOTAL), MAX_TOTAL);
  const next = (s: number) => allowed.find((d) => d > s);
  const prev = (s: number) => allowed.findLast((d) => d < s);
  let total = sized.reduce((s, x) => s + x.seconds, 0);
  while (total < target) {
    const grow = sized.filter((x) => next(x.seconds) !== undefined && total - x.seconds + next(x.seconds)! <= MAX_TOTAL).sort((a, b) => a.seconds - b.seconds)[0];
    if (!grow) break;
    total += next(grow.seconds)! - grow.seconds;
    grow.seconds = next(grow.seconds)!;
  }
  while (total > target) {
    const shrink = sized
      .filter((x) => {
        const p = prev(x.seconds);
        return p !== undefined && p >= x.needed && total - x.seconds + p >= MIN_TOTAL;
      })
      .sort((a, b) => b.seconds - a.seconds)[0];
    if (!shrink) break;
    total -= shrink.seconds - prev(shrink.seconds)!;
    shrink.seconds = prev(shrink.seconds)!;
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
