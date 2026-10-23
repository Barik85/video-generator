import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PRESETS, RunInput, RunStore, runMetrics, summarize, type Manifest, type RunMetrics } from "@reel/core";
import { z } from "zod";

const EvalSet = z.object({
  name: z.string(),
  cases: z.array(z.object({ id: z.string(), risk: z.string(), seconds: z.number().int(), idea: z.string() })).min(1),
});

type StartRun = (opts: { runsRoot: string; input: RunInput; onEvent?: (e: { type: string; message: string }) => void }) => Promise<Manifest>;

/**
 * Runs every case of an eval set through the normal pipeline, one after another, with no review
 * gates. Each run is tagged `<set>/<case>`; `reel report --eval <set>` then compares versions.
 * Paid presets need `--max-usd`: the eval stops before a case could push the total past it.
 */
export async function runEval(o: { file: string; preset: string; only?: string; budget: number; maxUsd?: number; runsRoot: string; startRun: StartRun }) {
  const set = EvalSet.parse(JSON.parse(readFileSync(o.file, "utf8")));
  const only = o.only?.split(",").map((s) => s.trim());
  const cases = set.cases.filter((c) => !only || only.includes(c.id));
  if (!(o.preset in PRESETS)) throw new Error(`unknown preset ${o.preset}`);
  const paid = !o.preset.startsWith("mock");
  if (paid && o.maxUsd === undefined) {
    throw new Error(`${o.preset} is paid: pass --max-usd (worst case here: ${cases.length} cases × $${o.budget} budget each)`);
  }
  let spent = 0;
  for (const c of cases) {
    if (paid && spent + o.budget > o.maxUsd!) {
      console.error(`stop: $${spent.toFixed(2)} spent; the next case could pass --max-usd ${o.maxUsd}`);
      break;
    }
    const input = RunInput.parse({ idea: c.idea, targetSeconds: c.seconds, preset: o.preset, budgetUsd: o.budget, evalCase: `${set.name}/${c.id}` });
    process.stderr.write(`\n\x1b[1m${set.name}/${c.id}\x1b[0m  (${c.risk})\n`);
    const m = await o.startRun({
      runsRoot: o.runsRoot,
      input,
      onEvent: (e) => {
        if (/^(stage\.fail|run\.|qa\.)/.test(e.type)) process.stderr.write(`  ${e.message}\n`);
      },
    });
    spent += m.cost.totalUsd;
    process.stderr.write(`  → ${m.runId} ${m.status} $${m.cost.totalUsd.toFixed(2)}\n`);
  }
  console.error(`\nspent $${spent.toFixed(2)}. Compare: npm run reel -- report --eval ${set.name}`);
}

/** Metrics of every run in runsRoot, grouped by pipeline version × preset. Reads files only; costs nothing. */
export async function report(o: { runsRoot: string; evalSet?: string; preset?: string; json: boolean }) {
  const manifests = (await RunStore.list(o.runsRoot)).filter(
    (m) => m.status !== "running" && (!o.evalSet || m.input.evalCase?.startsWith(`${o.evalSet}/`)) && (!o.preset || m.input.preset === o.preset),
  );
  const rows = await Promise.all(manifests.map((m) => runMetrics(o.runsRoot, m)));
  const groups = new Map<string, RunMetrics[]>();
  for (const r of rows) {
    const k = `${r.version} · ${r.preset}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const summaries = [...groups].map(([k, rs]) => summarize(k, rs)).sort((a, b) => a.key.localeCompare(b.key));
  if (o.json) return console.log(JSON.stringify({ summaries, runs: rows }, null, 2));

  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const num = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));
  console.log(`${rows.length} finished runs${o.evalSet ? ` of eval set "${o.evalSet}"` : ""} in ${o.runsRoot}\n`);
  console.log("| version · preset | runs | done | verbatim | mean WER | 1st-take | $/run | max $ | $/done video | work s | retries/run | rating | stopped at |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    const stops = Object.entries(s.stops).map(([k, n]) => `${k} ${n}`).join(", ") || "—";
    console.log(
      `| ${s.key} | ${s.runs} | ${pct(s.doneRate)} | ${pct(s.verbatimRate)} | ${num(s.meanWer, 3)} | ${pct(s.firstTakeRate)} | ${num(s.meanCost)} | ${num(s.maxCost)} | ${num(s.costPerDone)} | ${Math.round(s.meanWorkSeconds)} | ${num(s.retriesPerRun, 1)} | ${num(s.meanRating, 1)} | ${stops} |`,
    );
  }
  if (!o.evalSet) return;

  // Case × version matrix: the same test case side by side across pipeline versions and presets.
  const keys = summaries.map((s) => s.key);
  const cases = [...new Set(rows.map((r) => r.evalCase!.split("/")[1]!))].sort();
  console.log(`\n| case | ${keys.join(" | ")} |\n|---|${keys.map(() => "---").join("|")}|`);
  for (const c of cases) {
    const cells = keys.map((k) => {
      const latest = groups.get(k)!.filter((r) => r.evalCase === `${o.evalSet}/${c}`).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!latest) return "";
      const mark = latest.status === "done" ? "✓" : `✗ ${latest.stoppedAt}`;
      return `${mark} WER ${num(latest.werVsIdea, 2)} $${latest.costUsd.toFixed(2)}`;
    });
    console.log(`| ${c} | ${cells.join(" | ")} |`);
  }
}

/** Stores a person's 1–5 score for a run (rating.json in the run folder); `report` averages them. */
export async function rate(runsRoot: string, runId: string, score: number, note?: string) {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("score must be 1–5");
  await RunStore.open(runsRoot, runId); // fails clearly on an unknown run
  await writeFile(path.join(runsRoot, runId, "rating.json"), JSON.stringify({ score, note: note ?? null, at: new Date().toISOString() }, null, 2));
  console.log(`rated ${runId}: ${score}/5${note ? ` (${note})` : ""}`);
}
