#!/usr/bin/env -S npx tsx
import "dotenv/config";
import path from "node:path";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PRESETS, RunInput, RunStore, STAGES, resumeRun, startRun, type Manifest, type RunEvent, type StageName } from "@reel/core";

const USAGE = `reel — idea → vertical video

  reel run --idea "..." [--seconds 15] [--preset <name>] [--budget 8]
  reel run --idea-file idea.txt ...
  reel resume <runId> [--from <stage>]      stages: ${STAGES.join(", ")}
  reel ls
  reel show <runId>

Options: --runs <dir> (default ./runs), --json (print final manifest as JSON)
         --runner local|temporal (default $REEL_RUNNER or local). temporal: with TEMPORAL_ADDRESS
           set, uses that server and its worker; without, starts a dev server + worker in-process
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
    runs: { type: "string", default: "runs" },
    runner: { type: "string", default: process.env.REEL_RUNNER === "temporal" ? "temporal" : "local" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const runsRoot = path.resolve(values.runs!);
const [cmd, arg] = positionals;

const COLORS: Record<string, string> = { "stage.done": "32", "run.done": "32", "qa.pass": "32", "stage.fail": "31", "run.fail": "31", "qa.fail": "33", retry: "33", "validation.fail": "33", cost: "90" };
function printEvent(e: RunEvent) {
  const c = COLORS[e.type] ?? "0";
  const t = e.at.slice(11, 19);
  process.stderr.write(`\x1b[90m${t}\x1b[0m ${e.stage.padEnd(9)} \x1b[${c}m${e.message}\x1b[0m\n`);
}

function finish(m: Manifest) {
  if (values.json) console.log(JSON.stringify(m, null, 2));
  const dir = path.join(runsRoot, m.runId);
  if (m.status === "done") {
    console.log(`\n✓ ${path.join(dir, m.final!)}  ($${m.cost.totalUsd.toFixed(2)})`);
    process.exit(0);
  }
  const failed = Object.entries(m.stages).find(([, s]) => s.status === "failed");
  console.error(`\n✗ run ${m.runId} failed${failed ? ` at ${failed[0]}: ${failed[1].error}` : ""}`);
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
    const input = RunInput.parse({ idea, targetSeconds: Number(values.seconds), preset: values.preset, budgetUsd: Number(values.budget) });
    const runner = await loadRunner();
    const m = await runner.startRun({ runsRoot, input, onEvent: printEvent }).finally(runner.close);
    return finish(m);
  }
  if (cmd === "resume") {
    if (!arg) throw new Error("resume needs a runId");
    const from = values.from as StageName | undefined;
    if (from && !STAGES.includes(from)) throw new Error(`unknown stage ${from}`);
    const runner = await loadRunner();
    const m = await runner.resumeRun({ runsRoot, runId: arg, from, onEvent: printEvent }).finally(runner.close);
    return finish(m);
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
