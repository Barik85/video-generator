import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { MediaOutput, Script, Shot } from "../schemas.ts";
import { reviewNotes } from "../review.ts";
import type { StageContext } from "./context.ts";

/**
 * One keyframe per shot. Character consistency comes from pasting the same `look` text into
 * every prompt (cheap PoC approach; production would use a reference-image/identity model).
 */
export async function keyframesStage(ctx: StageContext, script: Script): Promise<MediaOutput> {
  await mkdir(ctx.store.path("keyframes"), { recursive: true });
  const out: MediaOutput = { shots: [] };
  // After a reviewer's redo: their notes go into the prompt, and a new seed gives a different image.
  const notes = reviewNotes(ctx.store, "keyframes");
  for (const shot of script.shots) {
    const rel = `keyframes/${shot.id}.png`;
    if (existsSync(ctx.store.path(rel))) {
      out.shots.push({ shotId: shot.id, file: rel, attempts: 0, seed: null });
      continue;
    }
    const seed = ctx.seed(notes.length ? `keyframe:${shot.id}:redo${notes.length}` : `keyframe:${shot.id}`);
    const res = await ctx.paid(`keyframe ${shot.id}`, 0.05, () =>
      ctx.providers.image.generate({ prompt: keyframePrompt(script, shot, notes), outFile: ctx.store.path(rel), seed }),
    );
    out.shots.push({ shotId: shot.id, file: rel, attempts: 1, seed: res.seed });
    await ctx.log("info", `keyframe ${shot.id} ready`);
  }
  return out;
}

export function keyframePrompt(script: Script, shot: Shot, notes: string[] = []): string {
  const cast = script.characters
    .filter((c) => shot.characterIds.includes(c.id))
    .map((c) => `${c.name}: ${c.look}`)
    .join(". ");
  return [
    `Vertical 9:16 cinematic film still, first frame of a shot.`,
    `Style: ${script.style}.`,
    `Scene: ${shot.visual}.`,
    `Framing: ${shot.camera}.`,
    cast ? `Characters: ${cast}.` : "",
    `Photorealistic, natural skin texture, mouth closed and relaxed, no text, no captions, no logos, no watermark.`,
    notes.length ? `Reviewer notes on the previous version, apply them: ${notes.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
