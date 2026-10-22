import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "./run-store.ts";
import { RunInput } from "./schemas.ts";
import { applyReview, requestReview, reviewNotes } from "./review.ts";
import { scriptUserMessage } from "./providers/script-prompt.ts";

async function storeWithFinishedScript() {
  const store = await RunStore.create(await mkdtemp(path.join(tmpdir(), "reel-review-")), RunInput.parse({ idea: "x", review: ["script"] }));
  await store.updateStage("script", { status: "done", finishedAt: new Date().toISOString(), output: "script.json" });
  return store;
}

describe("review gates", () => {
  it("waits, then records the decision and clears the wait", async () => {
    const store = await storeWithFinishedScript();
    expect(await requestReview(store, "script")).toBe(true);
    expect(store.get().awaitingReview?.gate).toBe("script");
    await applyReview(store, { gate: "script", action: "approve" });
    expect(store.get().awaitingReview).toBeNull();
    expect(store.get().reviews.map((r) => r.action)).toEqual(["approve"]);
  });

  it("does not ask again on resume once the current output is approved", async () => {
    const store = await storeWithFinishedScript();
    await requestReview(store, "script");
    await applyReview(store, { gate: "script", action: "approve" });
    expect(await requestReview(store, "script")).toBe(false);
  });

  it("asks again after a redo, and the stage gets the notes", async () => {
    const store = await storeWithFinishedScript();
    await requestReview(store, "script");
    await applyReview(store, { gate: "script", action: "redo", note: "make it sunset" });
    expect(store.stage("script").status).toBe("pending");
    expect(reviewNotes(store, "script")).toEqual(["make it sunset"]);
    await new Promise((r) => setTimeout(r, 5)); // the redone stage finishes after the decision
    await store.updateStage("script", { status: "done", finishedAt: new Date().toISOString() });
    expect(await requestReview(store, "script")).toBe(true);
  });

  it("puts the reviewer's notes and the previous script into the LLM prompt", () => {
    const msg = scriptUserMessage({ idea: "x", targetSeconds: 8, quotedLines: [], review: { previous: null, notes: ["make it sunset"] } });
    expect(msg).toMatch(/reviewer/i);
    expect(msg).toContain("- make it sunset");
  });
});
