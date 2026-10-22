import type {
  AssembleOutput,
  Manifest,
  MediaOutput,
  PlanOutput,
  QaOutput,
  RunEvent,
  RunInput,
  Script,
  StageName,
  VoiceOutput,
} from "@reel/core";

export type { Manifest, RunEvent, StageName, Script, QaOutput };

export const STAGES = ["script", "voice", "plan", "keyframes", "video", "assemble", "qa"] as const satisfies readonly StageName[];

export const STAGE_LABEL: Record<StageName, string> = {
  script: "Script",
  voice: "Voice (TTS)",
  plan: "Shot plan",
  keyframes: "Keyframes",
  video: "Video",
  assemble: "Assembly",
  qa: "QA",
};

export interface Meta {
  pipelineVersion: string;
  runner: "core" | "fake";
  runsRoot: string;
  presets: string[];
  stages: StageName[];
}

export type RunSummary = Manifest & { active: boolean };

export interface RunDetail {
  manifest: Manifest;
  outputs: {
    script?: Script;
    voice?: VoiceOutput;
    plan?: PlanOutput;
    keyframes?: MediaOutput;
    video?: MediaOutput;
    assemble?: AssembleOutput;
    qa?: QaOutput;
  };
  outputErrors: Partial<Record<StageName, string>>;
  files: Array<{ path: string; size: number }>;
  active: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status);
  return body as T;
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  runs: () => req<RunSummary[]>("/api/runs"),
  run: (id: string) => req<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  create: (input: RunInput) => req<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify(input) }),
  resume: (id: string, from?: StageName) =>
    req<{ runId: string }>(`/api/runs/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: JSON.stringify(from ? { from } : {}),
    }),
};

export const fileUrl = (runId: string, rel: string, download = false) =>
  `/api/runs/${encodeURIComponent(runId)}/files/${rel.split("/").map(encodeURIComponent).join("/")}${download ? "?download" : ""}`;

export const eventsUrl = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/events`;
