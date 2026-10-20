import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  AssembleOutput,
  Manifest,
  MediaOutput,
  PlanOutput,
  QaOutput,
  Script,
  STAGES,
  VoiceOutput,
  type StageName,
} from "@reel/core";
import type { z } from "zod";
import { RUNS_ROOT } from "./env.ts";

const RUN_ID = /^run_[A-Za-z0-9_-]+$/;

/** Absolute run dir for a syntactically valid id, else null (never lets ".." etc. through). */
export function runDir(runId: string): string | null {
  return RUN_ID.test(runId) ? path.join(RUNS_ROOT, runId) : null;
}

export async function readManifest(runId: string): Promise<Manifest | null> {
  const dir = runDir(runId);
  if (!dir) return null;
  try {
    return Manifest.parse(JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")));
  } catch {
    return null;
  }
}

const OUTPUT_SCHEMAS: Record<StageName, z.ZodType> = {
  script: Script,
  voice: VoiceOutput,
  plan: PlanOutput,
  keyframes: MediaOutput,
  video: MediaOutput,
  assemble: AssembleOutput,
  qa: QaOutput,
};

/** Parsed JSON outputs of the stages that have one. Invalid/missing files are reported, not thrown. */
export async function readOutputs(runId: string, m: Manifest) {
  const dir = runDir(runId)!;
  const outputs: Partial<Record<StageName, unknown>> = {};
  const outputErrors: Partial<Record<StageName, string>> = {};
  for (const stage of STAGES) {
    const rel = m.stages[stage]?.output;
    if (!rel) continue;
    const file = await safeResolve(dir, rel);
    if (!file) continue;
    try {
      const parsed = OUTPUT_SCHEMAS[stage].safeParse(JSON.parse(await readFile(file, "utf8")));
      if (parsed.success) outputs[stage] = parsed.data;
      else outputErrors[stage] = parsed.error.message;
    } catch (e) {
      outputErrors[stage] = e instanceof Error ? e.message : String(e);
    }
  }
  return { outputs, outputErrors };
}

export interface FileEntry {
  path: string;
  size: number;
}

/** Every artifact in the run dir (relative paths, posix separators), skipping temp files. */
export async function listFiles(runId: string): Promise<FileEntry[]> {
  const root = runDir(runId)!;
  const out: FileEntry[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && !e.name.endsWith(".tmp")) {
        out.push({ path: path.relative(root, abs).split(path.sep).join("/"), size: (await stat(abs)).size });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Resolves `rel` inside `dir` and returns the absolute path only if it (after following symlinks)
 * stays inside `dir`. Returns null for traversal attempts and missing files.
 */
export async function safeResolve(dir: string, rel: string): Promise<string | null> {
  if (rel.includes("\0")) return null;
  const candidate = path.resolve(dir, rel);
  if (!isInside(dir, candidate)) return null;
  try {
    const [realDir, realFile] = await Promise.all([realpath(dir), realpath(candidate)]);
    return isInside(realDir, realFile) ? realFile : null;
  } catch {
    return null;
  }
}

const isInside = (dir: string, p: string) => p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

export const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aiff": "audio/aiff",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
