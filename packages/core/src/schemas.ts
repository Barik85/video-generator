import { z } from "zod";

// ---------- Input ----------

export const RunInput = z.object({
  idea: z.string().min(1),
  /** Target length of the final video, seconds (8–30). */
  targetSeconds: z.number().int().min(8).max(30).default(15),
  preset: z.string().default("mock"),
  /** Hard spend cap for the run, USD. */
  budgetUsd: z.number().positive().default(8),
});
export type RunInput = z.infer<typeof RunInput>;

// ---------- Stage 1: script (LLM structured output) ----------
// Kept flat and explicit: this exact schema is sent to the LLM as the output format.

export const Character = z.object({
  id: z.string().describe("short slug, e.g. 'girl'"),
  name: z.string(),
  look: z
    .string()
    .describe("Visual description reused verbatim in every image/video prompt: age, face, hair, clothing."),
  voice: z.enum(["female", "male"]),
});

export const DialogueLine = z.object({
  id: z.string().describe("'l1', 'l2', ..."),
  characterId: z.string(),
  text: z.string().describe("Exact words to be spoken. Quoted lines from the idea must be copied character-for-character."),
});

export const Shot = z.object({
  id: z.string().describe("'s1', 's2', ..."),
  visual: z.string().describe("What we see: setting, action, lighting. No dialogue text here."),
  camera: z.string().describe("Framing and movement, e.g. 'locked medium close-up'."),
  characterIds: z.array(z.string()),
  lineIds: z.array(z.string()).describe("Dialogue lines spoken in this shot, in order. At most one speaking character per shot."),
  approxSeconds: z.number().describe("Rough length; the planner recomputes it from real audio."),
});

export const Script = z.object({
  title: z.string(),
  language: z.string().describe("ISO 639-1 code of the dialogue, e.g. 'en', 'uk'."),
  logline: z.string(),
  style: z.string().describe("Global visual style shared by all shots, e.g. 'cinematic, rainy neon night, 35mm'."),
  characters: z.array(Character).min(1),
  lines: z.array(DialogueLine).min(1),
  shots: z.array(Shot).min(1).max(3),
});
export type Script = z.infer<typeof Script>;
export type Shot = z.infer<typeof Shot>;
export type DialogueLine = z.infer<typeof DialogueLine>;

// ---------- Stage 2: voice ----------

export const VoiceLine = z.object({
  lineId: z.string(),
  text: z.string(),
  file: z.string().describe("path relative to run dir, wav"),
  seconds: z.number(),
  asrText: z.string().nullable().describe("What ASR heard in the isolated line (null when ASR unavailable)."),
  attempts: z.number().int(),
});
export const VoiceOutput = z.object({ lines: z.array(VoiceLine) });
export type VoiceOutput = z.infer<typeof VoiceOutput>;

// ---------- Stage 3: plan (deterministic timing) ----------

export const PlannedShot = z.object({
  shotId: z.string(),
  start: z.number(),
  seconds: z.number().int().describe("Integer: video models accept whole seconds."),
  /** Where each line starts inside the shot, seconds. */
  cues: z.array(z.object({ lineId: z.string(), at: z.number() })),
  /** Per-shot dialogue track (silence + lines at cue points), exactly `seconds` long. */
  track: z.string(),
});
export const PlanOutput = z.object({ shots: z.array(PlannedShot), totalSeconds: z.number() });
export type PlanOutput = z.infer<typeof PlanOutput>;
export type PlannedShot = z.infer<typeof PlannedShot>;

// ---------- Stages 4–5: keyframes, video ----------

export const ShotMedia = z.object({
  shotId: z.string(),
  file: z.string(),
  attempts: z.number().int(),
  seed: z.number().nullable(),
  /** Native-audio mode: the clip's own soundtrack, trimmed to the shot (used instead of the TTS track). */
  audio: z.string().optional(),
  /** Native-audio mode: WER of what ASR heard in the chosen take vs. the shot's lines. */
  wer: z.number().nullable().optional(),
});
export const MediaOutput = z.object({ shots: z.array(ShotMedia) });
export type MediaOutput = z.infer<typeof MediaOutput>;

// ---------- Stage 6–7: assemble, qa ----------

export const AssembleOutput = z.object({ file: z.string(), seconds: z.number() });
export type AssembleOutput = z.infer<typeof AssembleOutput>;

export const QaCheck = z.object({ name: z.string(), pass: z.boolean(), value: z.string(), expected: z.string() });
export const QaOutput = z.object({
  pass: z.boolean(),
  checks: z.array(QaCheck),
  expectedText: z.string(),
  heardText: z.string().nullable(),
  wer: z.number().nullable(),
});
export type QaOutput = z.infer<typeof QaOutput>;
export type QaCheck = z.infer<typeof QaCheck>;

// ---------- Run manifest (the single source of truth for a run) ----------

export const STAGES = ["script", "voice", "plan", "keyframes", "video", "assemble", "qa"] as const;
export type StageName = (typeof STAGES)[number];

export const StageStatus = z.enum(["pending", "running", "done", "failed"]);

export const StageRecord = z.object({
  status: StageStatus,
  attempts: z.number().int().default(0),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  /** Relative path of the stage's JSON output inside the run dir. */
  output: z.string().nullable().default(null),
});
export type StageRecord = z.infer<typeof StageRecord>;

export const CostItem = z.object({ stage: z.string(), what: z.string(), usd: z.number(), at: z.string() });
export type CostItem = z.infer<typeof CostItem>;

export const Manifest = z.object({
  runId: z.string(),
  pipelineVersion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["running", "done", "failed"]),
  input: RunInput,
  stages: z.record(z.string(), StageRecord),
  cost: z.object({ totalUsd: z.number(), items: z.array(CostItem) }),
  final: z.string().nullable().default(null),
});
export type Manifest = z.infer<typeof Manifest>;

/** One line of events.jsonl — the stream the CLI prints and a UI can tail (SSE). */
export const RunEvent = z.object({
  at: z.string(),
  stage: z.string(),
  type: z.string().describe("e.g. stage.start, stage.done, stage.fail, retry, cost, qa.fail, info"),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;
