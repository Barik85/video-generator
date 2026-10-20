import { mkdir, readFile, rename, writeFile, appendFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Manifest, RunEvent, STAGES, type RunInput, type StageName, type StageRecord } from "./schemas.ts";

export const PIPELINE_VERSION = "0.1.0";

const now = () => new Date().toISOString();

/**
 * A run lives in one directory: manifest.json (state), events.jsonl (log), and every artifact
 * each stage produced. Stages talk to each other only through files in this directory, so any
 * stage can be re-run or resumed after a crash without re-paying for earlier ones.
 */
export class RunStore {
  private constructor(
    readonly dir: string,
    private manifest: Manifest,
  ) {}

  static newRunId(): string {
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return `run_${ts}_${randomBytes(2).toString("hex")}`;
  }

  static async create(runsRoot: string, input: RunInput): Promise<RunStore> {
    const runId = RunStore.newRunId();
    const dir = path.join(runsRoot, runId);
    await mkdir(dir, { recursive: true });
    const stages: Record<string, StageRecord> = {};
    for (const s of STAGES) stages[s] = { status: "pending", attempts: 0, startedAt: null, finishedAt: null, error: null, output: null };
    const manifest: Manifest = {
      runId,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: now(),
      updatedAt: now(),
      status: "running",
      input,
      stages,
      cost: { totalUsd: 0, items: [] },
      final: null,
    };
    const store = new RunStore(dir, manifest);
    await store.save();
    return store;
  }

  static async open(runsRoot: string, runId: string): Promise<RunStore> {
    const dir = path.join(runsRoot, runId);
    const raw = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    return new RunStore(dir, Manifest.parse(raw));
  }

  static async list(runsRoot: string): Promise<Manifest[]> {
    if (!existsSync(runsRoot)) return [];
    const ids = (await readdir(runsRoot)).filter((d) => d.startsWith("run_"));
    const out: Manifest[] = [];
    for (const id of ids) {
      try {
        out.push((await RunStore.open(runsRoot, id)).get());
      } catch {
        // half-written or foreign directory: skip
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(): Manifest {
    return structuredClone(this.manifest);
  }

  get runId() {
    return this.manifest.runId;
  }

  path(rel: string): string {
    return path.join(this.dir, rel);
  }

  stage(name: StageName): StageRecord {
    return this.manifest.stages[name]!;
  }

  async updateStage(name: StageName, patch: Partial<StageRecord>) {
    this.manifest.stages[name] = { ...this.stage(name), ...patch };
    await this.save();
  }

  async setStatus(status: Manifest["status"], final?: string) {
    this.manifest.status = status;
    if (final !== undefined) this.manifest.final = final;
    await this.save();
  }

  /** Marks `from` and every later stage pending so the next run recomputes them. */
  async invalidateFrom(from: StageName) {
    const idx = STAGES.indexOf(from);
    for (const s of STAGES.slice(idx)) {
      this.manifest.stages[s] = { ...this.stage(s), status: "pending", error: null };
    }
    this.manifest.status = "running";
    await this.save();
  }

  async addCost(stage: string, what: string, usd: number) {
    this.manifest.cost.items.push({ stage, what, usd, at: now() });
    this.manifest.cost.totalUsd = round(this.manifest.cost.totalUsd + usd);
    await this.save();
    await this.event(stage, "cost", `${what}: $${usd.toFixed(3)} (total $${this.manifest.cost.totalUsd.toFixed(2)})`, { usd });
  }

  async writeJson(rel: string, data: unknown) {
    const file = this.path(rel);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, JSON.stringify(data, null, 2));
  }

  async readJson<T>(rel: string): Promise<T> {
    return JSON.parse(await readFile(this.path(rel), "utf8")) as T;
  }

  async event(stage: string, type: string, message: string, data?: Record<string, unknown>) {
    const ev: RunEvent = { at: now(), stage, type, message, ...(data ? { data } : {}) };
    await appendFile(this.path("events.jsonl"), JSON.stringify(ev) + "\n");
    this.listeners.forEach((l) => l(ev));
  }

  private listeners: Array<(e: RunEvent) => void> = [];
  onEvent(fn: (e: RunEvent) => void) {
    this.listeners.push(fn);
  }

  private async save() {
    this.manifest.updatedAt = now();
    await atomicWrite(this.path("manifest.json"), JSON.stringify(this.manifest, null, 2));
  }
}

/** write-then-rename so a reader (CLI, UI, crash) never sees a half-written file */
async function atomicWrite(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}

const round = (n: number) => Math.round(n * 10000) / 10000;
