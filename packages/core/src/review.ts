import { rm } from "node:fs/promises";
import type { RunStore } from "./run-store.ts";
import type { ReviewDecision, ReviewGate } from "./schemas.ts";

/**
 * Human-in-the-loop gates. Both runners use these two steps: the in-process runner waits on a
 * callback, the Temporal workflow waits on a signal. The decision itself lives in the manifest,
 * so a run that is resumed after a crash asks again unless the current output was approved.
 */

/** Pauses the run at `gate`. False if the stage's current output was already approved (e.g. on resume). */
export async function requestReview(store: RunStore, gate: ReviewGate): Promise<boolean> {
  const m = store.get();
  const finished = m.stages[gate]?.finishedAt ?? "";
  const last = m.reviews.filter((r) => r.gate === gate).at(-1);
  if (last?.action === "approve" && last.at >= finished) return false;
  await store.setAwaitingReview(gate);
  await store.event(gate, "review.wait", `waiting for review of the ${gate}: approve, redo with a note, or reject`, { gate });
  return true;
}

/**
 * Records the decision. On redo, the gate stage goes back to pending and its media is deleted, so
 * the stage runs again and reads the note (see `reviewNotes`).
 */
export async function applyReview(store: RunStore, d: ReviewDecision): Promise<void> {
  await store.addReview(d);
  const note = d.note ? `: ${d.note}` : "";
  await store.event(d.gate, `review.${d.action}`, `${d.gate} ${d.action === "approve" ? "approved" : d.action === "redo" ? "sent back for a redo" : "rejected"}${note}`, { ...d });
  if (d.action === "redo") {
    await store.invalidateFrom(d.gate);
    if (d.gate === "keyframes") await rm(store.path("keyframes"), { recursive: true, force: true });
  }
  if (d.action === "reject") await store.event("run", "run.fail", `stopped: ${d.gate} rejected by the reviewer${note}`);
}

/** Redo notes for a stage, oldest first: the stage passes them to the model on its next attempt. */
export function reviewNotes(store: RunStore, gate: ReviewGate): string[] {
  return store
    .get()
    .reviews.filter((r) => r.gate === gate && r.action === "redo" && r.note)
    .map((r) => r.note!);
}
