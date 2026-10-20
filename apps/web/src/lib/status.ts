import { STAGE_LABEL, STAGES, type Manifest } from "./api.ts";

export type Tone = "done" | "run" | "fail" | "qa" | "wait";

export const TONE_CLASS: Record<Tone, string> = {
  done: "bg-ok-bg text-ok border-ok-bd",
  run: "bg-raised text-fg border-line-strong",
  fail: "bg-fail-bg text-fail border-fail-bd",
  qa: "bg-warn-bg text-warn border-warn-bd",
  wait: "bg-accent-bg text-accent-hi border-accent-bd",
};

/** A "running" manifest nobody has touched for this long is most likely an interrupted process. */
const STALE_MS = 10 * 60 * 1000;

export interface RunStatusView {
  tone: Tone;
  label: string;
  /** Short "where is it" text for the Stage column */
  stage: string;
  stale: boolean;
}

export function runStatus(m: Manifest, active: boolean): RunStatusView {
  const failedStage = STAGES.find((s) => m.stages[s]?.status === "failed");
  const runningStage = STAGES.find((s) => m.stages[s]?.status === "running");
  if (m.status === "done") return { tone: "done", label: "Готово", stage: "QA passed", stale: false };
  if (m.status === "failed") {
    const err = failedStage ? m.stages[failedStage]?.error ?? "" : "";
    if (failedStage === "qa") return { tone: "qa", label: "QA не пройдено", stage: err || "QA", stale: false };
    return {
      tone: "fail",
      label: "Впало",
      stage: failedStage ? `${STAGE_LABEL[failedStage]}: ${err}` : err || "—",
      stale: false,
    };
  }
  const stale = !active && Date.now() - Date.parse(m.updatedAt) > STALE_MS;
  const current = runningStage ?? STAGES.find((s) => m.stages[s]?.status !== "done");
  return {
    tone: stale ? "qa" : "run",
    label: stale ? "Перервано?" : "Генерується",
    stage: current ? STAGE_LABEL[current] : "—",
    stale,
  };
}
