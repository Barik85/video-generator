#!/usr/bin/env -S npx tsx
import "dotenv/config";
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { PRESETS, REVIEW_GATES, ReviewDecision, RunInput, RunStore, STAGES, resumeRun, startRun } from "@reel/core";
import type { Manifest, ReviewGate, RunEvent, Script, StageName } from "@reel/core";

const USAGE = `reel — idea → vertical video

  reel run --idea "..." [--seconds 15] [--preset <name>] [--budget 8] [--review script,keyframes]
  reel run --idea-file idea.txt ...
  reel resume <runId> [--from <stage>]      stages: ${STAGES.join(", ")}
  reel review <runId> approve|redo|reject [--note "..."]   answer a paused run (Temporal server only)
  reel ls
  reel show <runId>

Options: --runs <dir> (default ./runs), --json (print final manifest as JSON)
         --runner local|temporal (default $REEL_RUNNER or local). temporal: with TEMPORAL_ADDRESS
           set, uses that server and its worker; without, starts a dev server + worker in-process
         --review <gates>: pause after these stages for a person to approve, redo with a note, or
           reject (${REVIEW_GATES.join(", ")}). The terminal asks; the UI can answer too.
Presets: ${Object.keys(PRESETS).join(", ")}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    idea: { type: "string" },
    "idea-file": { type: "string" },
    seconds: { type: "string", default: "15" },
    preset: { type: "string", default: "mock" },
    budget: { type: "string", default: "8" },
    from: { type: "string" },
    review: { type: "string", default: "" },
    note: { type: "string" },
    runs: { type: "string", default: "runs" },
    runner: { type: "string", default: process.env.REEL_RUNNER === "temporal" ? "temporal" : "local" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const runsRoot = path.resolve(values.runs!);
const [cmd, arg, action] = positionals;

const COLORS: Record<string, string> = { "stage.done": "32", "run.done": "32", "qa.pass": "32", "stage.fail": "31", "run.fail": "31", "qa.fail": "33", retry: "33", "validation.fail": "33", cost: "90", "review.wait": "36", "review.approve": "32", "review.redo": "33", "review.reject": "31" };
function printEvent(e: RunEvent) {
  const c = COLORS[e.type] ?? "0";
  const t = e.at.slice(11, 19);
  // The gate was answered elsewhere (UI, another terminal): drop the local question.
  if (e.type.startsWith("review.") && e.type !== "review.wait") prompt?.abort();
  process.stderr.write(`\x1b[90m${t}\x1b[0m ${e.stage.padEnd(9)} \x1b[${c}m${e.message}\x1b[0m\n`);
  if (e.type === "review.wait" && !onReview) {
    process.stderr.write(`          answer in the UI, or: npm run reel -- review ${currentRunId} approve|redo|reject [--note "..."]\n`);
  }
}

let currentRunId = "";

let prompt: AbortController | null = null;

/** Shows what is up for review and asks for a decision on the terminal. */
async function askReview(gate: ReviewGate, runId: string): Promise<ReviewDecision> {
  const dir = path.join(runsRoot, runId);
  process.stderr.write(`\n\x1b[1m⏸  ${gate} ready for review\x1b[0m\n${describeForReview(gate, dir)}\n`);
  const ac = new AbortController();
  prompt = ac;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const a = (await rl.question("   [a]pprove · [r]edo with a note · [x] reject > ", { signal: ac.signal })).trim().toLowerCase();
      if (a === "a") return { gate, action: "approve" };
      if (a === "x") return { gate, action: "reject" };
      if (a === "r") {
        const note = (await rl.question("   what should change? > ", { signal: ac.signal })).trim();
        if (note) return { gate, action: "redo", note };
      }
    }
  } finally {
    rl.close();
    prompt = null;
  }
}

function describeForReview(gate: ReviewGate, dir: string): string {
  if (gate === "keyframes") {
    const kf = path.join(dir, "keyframes");
    const files = existsSync(kf) ? readdirSync(kf).filter((f) => /^s\d+\.png$/.test(f)) : [];
    return files.map((f) => `   ${path.join(kf, f)}`).join("\n");
  }
  const s = JSON.parse(readFileSync(path.join(dir, "script.json"), "utf8")) as Script;
  const who = (id: string) => s.characters.find((c) => c.id === id)?.name ?? id;
  return [
    `   "${s.title}" — ${s.style}`,
    ...s.characters.map((c) => `   ${c.name}: ${c.look}`),
    ...s.shots.map((sh) => {
      const lines = s.lines.filter((l) => sh.lineIds.includes(l.id)).map((l) => `\n        ${who(l.characterId)}: "${l.text}"`);
      return `   ${sh.id} (~${sh.approxSeconds}s, ${sh.camera}) ${sh.visual}${lines.join("")}`;
    }),
    `   full: ${path.join(dir, "script.json")}`,
  ].join("\n");
}

/** Interactive terminals answer gates themselves; otherwise only the UI or `reel review` can. */
const onReview = process.stdin.isTTY ? askReview : undefined;

function finish(m: Manifest) {
  if (values.json) console.log(JSON.stringify(m, null, 2));
  const dir = path.join(runsRoot, m.runId);
  if (m.status === "done") {
    console.log(`\n✓ ${path.join(dir, m.final!)}  ($${m.cost.totalUsd.toFixed(2)})`);
    process.exit(0);
  }
  const failed = Object.entries(m.stages).find(([, s]) => s.status === "failed");
  const rejected = m.reviews.at(-1)?.action === "reject" ? m.reviews.at(-1) : undefined;
  const why = failed ? ` at ${failed[0]}: ${failed[1].error}` : rejected ? `: ${rejected.gate} rejected at review${rejected.note ? ` (${rejected.note})` : ""}` : "";
  console.error(`\n✗ run ${m.runId} failed${why}`);
  console.error(`  inspect: ${dir}\n  retry:   npm run reel -- resume ${m.runId}${failed ? ` --from ${failed[0]}` : ""}${values.runner === "temporal" ? " --runner temporal" : ""}`);
  process.exit(1);
}

/** The in-process runner from @reel/core, or the Temporal one with the same contract (loaded only when asked for). */
async function loadRunner() {
  if (values.runner === "local") return { startRun, resumeRun, close: async () => {} };
  if (values.runner !== "temporal") throw new Error(`unknown runner ${values.runner}; use local or temporal`);
  const t = await import("@reel/temporal");
  return { startRun: t.startRun, resumeRun: t.resumeRun, close: t.closeTemporal };
}

async function main() {
  if (values.help || !cmd) return console.log(USAGE);

  if (cmd === "run") {
    const idea = values.idea ?? (values["idea-file"] ? readFileSync(values["idea-file"], "utf8").trim() : undefined);
    if (!idea) throw new Error("--idea or --idea-file is required");
    const review = values.review!.split(",").map((s) => s.trim()).filter(Boolean);
    const input = RunInput.parse({ idea, targetSeconds: Number(values.seconds), preset: values.preset, budgetUsd: Number(values.budget), review });
    const runner = await loadRunner();
    const m = await runner.startRun({ runsRoot, input, onEvent: printEvent, onReview, onCreated: (id) => (currentRunId = id) }).finally(runner.close);
    return finish(m);
  }
  if (cmd === "resume") {
    if (!arg) throw new Error("resume needs a runId");
    const from = values.from as StageName | undefined;
    if (from && !STAGES.includes(from)) throw new Error(`unknown stage ${from}`);
    const runner = await loadRunner();
    const m = await runner.resumeRun({ runsRoot, runId: arg, from, onEvent: printEvent, onReview, onCreated: (id) => (currentRunId = id) }).finally(runner.close);
    return finish(m);
  }
  if (cmd === "review") {
    if (!arg) throw new Error("review needs a runId");
    const waiting = (await RunStore.open(runsRoot, arg)).get().awaitingReview;
    if (!waiting) throw new Error(`run ${arg} is not waiting for review`);
    if (!process.env.TEMPORAL_ADDRESS) {
      throw new Error("`reel review` signals a Temporal server (set TEMPORAL_ADDRESS). Runs on the local runner are answered in the terminal or UI that started them.");
    }
    const decision = ReviewDecision.parse({ gate: waiting.gate, action, ...(values.note ? { note: values.note } : {}) });
    const t = await import("@reel/temporal");
    await t.sendReview(arg, decision).finally(t.closeTemporal);
    console.log(`sent: ${decision.action} ${decision.gate}${decision.note ? ` (${decision.note})` : ""}`);
    return;
  }
  if (cmd === "ls") {
    for (const m of await RunStore.list(runsRoot)) {
      console.log(`${m.runId}  ${m.status.padEnd(7)} $${m.cost.totalUsd.toFixed(2).padStart(5)}  ${m.input.preset.padEnd(14)} ${m.input.idea.slice(0, 60)}`);
    }
    return;
  }
  if (cmd === "show") {
    if (!arg) throw new Error("show needs a runId");
    const m = (await RunStore.open(runsRoot, arg)).get();
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log(USAGE);
  process.exit(2);
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
});
