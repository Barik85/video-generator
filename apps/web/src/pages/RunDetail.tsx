import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileUrl, STAGE_LABEL, STAGES, type Manifest, type ReviewDecision, type RunDetail, type RunEvent, type StageName } from "../lib/api.ts";
import { useRunEvents, type StreamState } from "../lib/useRunEvents.ts";
import { runStatus } from "../lib/status.ts";
import { formatBytes, formatDuration, formatTime, plural, secs } from "../lib/format.ts";
import { usd } from "../lib/pricing.ts";
import { diffWords, normalizeWord, words } from "../lib/text.ts";
import { Badge, Card, ErrorBox, Icon, Spinner, Stat, buttonClass } from "../components/ui.tsx";

function useNow(enabled: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [enabled, ms]);
  return now;
}

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const [generation, setGeneration] = useState(0);
  const stream = useRunEvents(runId, generation);
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.run(runId),
    // SSE drives refreshes; poll slowly only as a fallback while the stream is down
    refetchInterval: (q) => (q.state.data?.manifest.status === "running" && stream.state !== "live" ? 4000 : false),
  });

  if (run.isPending) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-8 text-muted sm:px-6">
        <Spinner /> Loading…
      </main>
    );
  }
  if (run.error) {
    return (
      <main className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-8 sm:px-6">
        <Link to="/runs" className="text-[13px] no-underline">
          ← Runs
        </Link>
        <ErrorBox error={run.error} />
      </main>
    );
  }
  return <RunView detail={run.data} events={stream.events} streamState={stream.state} onResumed={() => setGeneration((g) => g + 1)} />;
}

function RunView({ detail, events, streamState, onResumed }: { detail: RunDetail; events: RunEvent[]; streamState: StreamState; onResumed: () => void }) {
  const { manifest: m, outputs, files } = detail;
  const status = runStatus(m, detail.active);
  const running = m.status === "running" && !status.stale && !m.awaitingReview;
  const now = useNow(running);
  const elapsed = (running ? now : Date.parse(m.updatedAt)) - Date.parse(m.createdAt);
  const seconds = outputs.assemble?.seconds ?? outputs.plan?.totalSeconds ?? null;
  const retryEvents = events.filter((e) => e.type === "retry");
  const retries = retryEvents.length || sumRetries(detail);
  const retryWhere = [...new Set(retryEvents.map((e) => `${(e.data?.shotId as string | undefined) ?? ""} · ${e.stage}`.replace(/^ · /, "")))].join(", ");
  const costRatio = m.cost.totalUsd / m.input.budgetUsd;
  const wer = outputs.qa?.wer;
  const finalFile = finalOf(detail);

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-16 pt-7 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/runs" className="text-[13px] no-underline">
              ← Runs
            </Link>
            <span className="font-mono text-[13px] text-muted">{m.runId}</span>
            <Badge tone={status.tone}>
              {m.status === "done" ? <Icon.Check size={14} /> : running ? <Spinner /> : null}
              {m.status === "done" ? `Done · QA ${outputs.qa?.pass === false ? "failed" : "passed"}` : status.label}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{outputs.script?.title ?? m.input.idea.slice(0, 80)}</h1>
          <p className="max-w-[760px] text-sm text-muted">{m.input.idea}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ResumeControl m={m} disabled={running} onResumed={onResumed} />
          {finalFile ? (
            <a href={fileUrl(m.runId, finalFile, true)} className={buttonClass.primary} download>
              Download final.mp4
            </a>
          ) : (
            <button type="button" disabled className={buttonClass.primary}>
              Download final.mp4
            </button>
          )}
        </div>
      </div>

      {m.awaitingReview && <ReviewCard m={m} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Stat label="Duration">{seconds !== null ? secs(seconds) : `target ${m.input.targetSeconds} s`}</Stat>
        <Stat label="Cost / limit" tone={costRatio > 1 ? "fail" : costRatio > 0.8 ? "warn" : undefined}>
          {usd(m.cost.totalUsd)} <span className="text-sm text-muted">/ {usd(m.input.budgetUsd)}</span>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-line" role="progressbar" aria-label="Budget spent" aria-valuenow={Math.round(costRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${costRatio > 1 ? "bg-fail" : costRatio > 0.8 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, costRatio * 100)}%` }} />
          </div>
        </Stat>
        <Stat label="Elapsed">{formatDuration(elapsed)}</Stat>
        <Stat label="Retries">
          {retries} {retryWhere && <span className="text-sm text-muted">{retryWhere}</span>}
        </Stat>
        <Stat label="Verbatim (WER)" tone={wer == null ? undefined : wer === 0 ? "ok" : "fail"}>
          {wer == null ? "—" : wer.toFixed(2)}
        </Stat>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <StageTimeline m={m} events={events} streamState={streamState} now={now} />
          <Shots detail={detail} />
          <EventLog events={events} />
        </div>

        <aside aria-label="Result" className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <FinalVideo detail={detail} />
          <Verbatim detail={detail} />
          <QaChecks detail={detail} />
          <Card title="Artifacts" className="flex flex-col">
            {files.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
            <ul className="m-0 flex list-none flex-col p-0">
              {files.map((f) => (
                <li key={f.path}>
                  <a href={fileUrl(m.runId, f.path)} target="_blank" rel="noreferrer" className="flex justify-between gap-3 py-1.5 font-mono text-[12.5px] no-underline">
                    <span className="break-all">{f.path}</span>
                    <span className="whitespace-nowrap text-muted">{formatBytes(f.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </main>
  );
}

/** manifest.final, or the assembled file of a run that failed afterwards (e.g. in QA). */
const finalOf = ({ manifest, outputs }: RunDetail) => manifest.final ?? outputs.assemble?.file ?? null;

function sumRetries({ outputs }: RunDetail) {
  return [outputs.keyframes, outputs.video].reduce((a, o) => a + (o?.shots.reduce((b, s) => b + Math.max(0, s.attempts - 1), 0) ?? 0), 0);
}

// ---------- resume ----------

function ResumeControl({ m, disabled, onResumed }: { m: Manifest; disabled: boolean; onResumed: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState<"" | StageName>("");
  const resume = useMutation({
    mutationFn: () => api.resume(m.runId, from || undefined),
    onSuccess: () => {
      onResumed();
      void qc.invalidateQueries({ queryKey: ["run", m.runId] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="resume-from" className="sr-only">
          Stage to restart from
        </label>
        <select
          id="resume-from"
          value={from}
          onChange={(e) => setFrom(e.target.value as "" | StageName)}
          disabled={disabled || resume.isPending}
          className="min-h-11 rounded-[10px] border border-line-strong bg-ground px-3 text-fg disabled:opacity-50"
        >
          <option value="">first unfinished</option>
          {STAGES.map((s, i) => (
            <option key={s} value={s}>
              {i + 1} · {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => resume.mutate()} disabled={disabled || resume.isPending} className={buttonClass.secondary}>
          {resume.isPending && <Spinner />}
          Restart from stage
        </button>
      </div>
      {resume.error && <span className="text-[13px] text-fail">{resume.error.message}</span>}
    </div>
  );
}

const REVIEW_HINT = {
  script: "Read the shots and lines under Shots. Changing text costs cents; after approval the run pays for voice, keyframes and video.",
  keyframes: "Check the character and the location in the keyframes under Shots. After approval the run pays for video, the most expensive step.",
} as const;

function ReviewCard({ m }: { m: Manifest }) {
  const qc = useQueryClient();
  const gate = m.awaitingReview!.gate;
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (action: ReviewDecision["action"]) => api.review(m.runId, { gate, action, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["run", m.runId] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  const redos = m.reviews.filter((r) => r.gate === gate && r.action === "redo").length;
  return (
    <section aria-label="Review" className="flex flex-col gap-3 rounded-[14px] border border-accent-bd bg-accent-bg p-5 sm:p-6">
      <h2 className="text-base font-semibold">
        Waiting for your review: {STAGE_LABEL[gate]}
        {redos > 0 && <span className="ml-2 text-sm font-normal text-muted">after {redos} redo{redos > 1 ? "s" : ""}</span>}
      </h2>
      <p className="text-sm text-soft">{REVIEW_HINT[gate]}</p>
      <label htmlFor="review-note" className="text-[13px] text-muted">
        Note for a redo (what should change)
      </label>
      <textarea
        id="review-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        className="rounded-[10px] border border-line-strong bg-ground px-3 py-2 text-fg"
        placeholder={gate === "script" ? "e.g. make it sunset, and let the cashier answer" : "e.g. she should look older, darker coat"}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => decide.mutate("approve")} disabled={decide.isPending} className={buttonClass.primary}>
          Approve
        </button>
        <button type="button" onClick={() => decide.mutate("redo")} disabled={decide.isPending || !note.trim()} className={buttonClass.secondary} title={note.trim() ? undefined : "Write a note first"}>
          Redo with note
        </button>
        <button type="button" onClick={() => decide.mutate("reject")} disabled={decide.isPending} className={buttonClass.secondary}>
          Reject and stop
        </button>
        {decide.isPending && <Spinner className="self-center" />}
      </div>
      {decide.error && <span className="text-[13px] text-fail">{decide.error.message}</span>}
    </section>
  );
}

// ---------- stages ----------

function StageTimeline({ m, events, streamState, now }: { m: Manifest; events: RunEvent[]; streamState: StreamState; now: number }) {
  return (
    <Card
      title={
        <span className="flex items-center justify-between gap-3">
          Stages
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${streamState === "live" ? "bg-ok" : streamState === "error" ? "bg-fail" : "bg-faint"}`} />
            {streamState === "live" ? "live" : streamState === "ended" ? "ended" : streamState === "error" ? "disconnected" : "connecting…"}
          </span>
        </span>
      }
    >
      <ol className="m-0 flex list-none flex-col p-0">
        {STAGES.map((s, i) => {
          const rec = m.stages[s];
          const st = rec?.status ?? "pending";
          const stageEvents = events.filter((e) => e.stage === s);
          const retried = (rec?.attempts ?? 0) > 1 || stageEvents.some((e) => e.type === "retry");
          const cost = m.cost.items.filter((c) => c.stage === s).reduce((a, c) => a + c.usd, 0);
          const dur = rec?.startedAt ? (rec.finishedAt ? Date.parse(rec.finishedAt) : st === "running" ? now : NaN) - Date.parse(rec.startedAt) : NaN;
          const last = [...stageEvents].reverse().find((e) => e.type !== "cost");
          const detail = st === "failed" ? rec?.error : last?.message;
          const meta = [Number.isFinite(dur) ? formatDuration(dur) : null, cost > 0 ? usd(cost) : null, (rec?.attempts ?? 0) > 1 ? `attempt ${rec?.attempts}` : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={s} className="flex items-start gap-3.5 border-t border-line-soft py-2.5">
              <StageIcon status={st} retried={retried} />
              <div className="min-w-0 flex-auto">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className={`font-medium ${st === "pending" ? "text-muted" : ""}`}>
                    {i + 1} · {STAGE_LABEL[s]}
                  </span>
                  <span className="font-mono text-[12.5px] text-muted">{meta || (st === "pending" ? "pending" : "")}</span>
                </div>
                {detail && <div className={`text-[13px] ${st === "failed" ? "text-fail" : "text-muted"}`}>{detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StageIcon({ status, retried }: { status: string; retried: boolean }) {
  const base = "flex h-6 w-6 flex-none items-center justify-center rounded-full border";
  if (status === "done" && retried)
    return (
      <span className={`${base} border-warn-bd bg-warn-bg text-warn`} title="Done after retry">
        <Icon.Retry />
      </span>
    );
  if (status === "done")
    return (
      <span className={`${base} border-ok-bd bg-ok-bg text-ok`} title="Done">
        <Icon.Check />
      </span>
    );
  if (status === "running")
    return (
      <span className={`${base} border-accent-bd bg-accent-bg text-accent`} title="Running">
        <Spinner />
      </span>
    );
  if (status === "failed")
    return (
      <span className={`${base} border-fail-bd bg-fail-bg text-fail`} title="Error">
        <Icon.X />
      </span>
    );
  return (
    <span className={`${base} border-line-strong bg-ground text-faint`} title="Pending">
      <Icon.Dot size={10} />
    </span>
  );
}

// ---------- shots ----------

function Shots({ detail }: { detail: RunDetail }) {
  const { manifest: m, outputs } = detail;
  const script = outputs.script;
  const v = (stage: StageName) => m.stages[stage]?.finishedAt ?? "";
  return (
    <Card title="Shots" className="flex flex-col">
      {!script && <p className="text-sm text-muted">Shots appear after the "Script" stage.</p>}
      <div className="flex flex-col gap-3.5">
        {script?.shots.map((shot, i) => {
          const plan = outputs.plan?.shots.find((p) => p.shotId === shot.id);
          const key = outputs.keyframes?.shots.find((k) => k.shotId === shot.id);
          const vid = outputs.video?.shots.find((k) => k.shotId === shot.id);
          const lines = shot.lineIds.map((id) => ({
            line: script.lines.find((l) => l.id === id),
            voice: outputs.voice?.lines.find((l) => l.lineId === id),
            cue: plan?.cues.find((c) => c.lineId === id),
          }));
          return (
            <article key={shot.id} className="flex flex-wrap gap-4 rounded-xl border border-line bg-panel p-3.5" aria-label={`Shot ${i + 1}`}>
              <div className="flex gap-2">
                <Thumb label={`keyframe ${i + 1}`}>
                  {key && <img src={`${fileUrl(m.runId, key.file)}?v=${encodeURIComponent(v("keyframes"))}`} alt={`Keyframe of shot ${i + 1}`} className="h-full w-full object-cover" />}
                </Thumb>
                <Thumb label={`video ${i + 1}`}>
                  {vid && (
                    <video
                      src={`${fileUrl(m.runId, vid.file)}?v=${encodeURIComponent(v("video"))}`}
                      controls
                      playsInline
                      preload="metadata"
                      poster={key ? fileUrl(m.runId, key.file) : undefined}
                      className="h-full w-full bg-black object-cover"
                      aria-label={`Video of shot ${i + 1}`}
                    />
                  )}
                </Thumb>
              </div>
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Shot {i + 1}</span>
                  <span className="font-mono text-xs text-muted">
                    {plan ? `${plan.start.toFixed(1)}–${(plan.start + plan.seconds).toFixed(1)} s` : `~${shot.approxSeconds} s`}
                    {vid && ` · ${vid.attempts} ${plural(vid.attempts, ["attempt", "attempts"])}`}
                  </span>
                </div>
                <div className="text-[13px] text-soft">{shot.visual}</div>
                <div className="font-mono text-xs text-muted">{shot.camera}</div>
                {lines.length === 0 && <div className="text-[13px] text-muted">Lines: none (ambient + SFX)</div>}
                {lines.map(({ line, voice, cue }, k) => {
                  if (!line) return null;
                  const who = script.characters.find((c) => c.id === line.characterId)?.name ?? line.characterId;
                  const asrDiffers = voice?.asrText != null && words(voice.asrText).map(normalizeWord).join(" ") !== words(line.text).map(normalizeWord).join(" ");
                  return (
                    <div key={line.id ?? k} className="flex flex-col gap-1.5 rounded-lg bg-accent-bg px-2.5 py-2 text-[13px] text-accent-hi">
                      <div className="flex items-start gap-2">
                        <Icon.Lock className="mt-[3px] flex-none" />
                        <span>
                          <span className="text-muted">{who}:</span> «{line.text}»
                          {voice && (
                            <span className="font-mono text-xs text-muted">
                              {" "}
                              · {voice.file} · {secs(voice.seconds)}
                              {cue && ` · cue ${cue.at.toFixed(1)} s`}
                            </span>
                          )}
                        </span>
                      </div>
                      {voice && <audio src={fileUrl(m.runId, voice.file)} controls preload="none" className="h-8 w-full max-w-[360px]" aria-label={`Voice of line ${line.id}`} />}
                      {asrDiffers && <div className="text-warn">ASR heard: "{voice?.asrText}"</div>}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

function Thumb({ label, children }: { label: string; children: ReactNode }) {
  const empty = !children;
  return (
    <div
      className={`flex h-[213px] w-[120px] flex-none items-center justify-center overflow-hidden rounded-lg text-center text-xs text-dim ${empty ? "border border-dashed border-line-dash bg-placeholder" : "bg-black"}`}
    >
      {children || `[${label}]`}
    </div>
  );
}

// ---------- events ----------

function EventLog({ events }: { events: RunEvent[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  return (
    <section aria-label="Event log" className="rounded-[14px] border border-line bg-panel px-5 py-4.5">
      <h2 className="mb-2.5 text-base font-semibold">Event log</h2>
      <pre ref={ref} className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-[1.7] text-soft" tabIndex={0}>
        {events.length === 0
          ? "—"
          : events.map((e, i) => (
              <span key={i} className={e.type.includes("fail") ? "text-fail" : e.type === "retry" ? "text-warn" : undefined}>
                {`${formatTime(e.at)}  ${`${e.stage}.${e.type}`.padEnd(22)} ${e.message}\n`}
              </span>
            ))}
      </pre>
    </section>
  );
}

// ---------- result ----------

function FinalVideo({ detail }: { detail: RunDetail }) {
  const { manifest: m, outputs } = detail;
  const [dims, setDims] = useState<string | null>(null);
  const firstKey = outputs.keyframes?.shots[0]?.file;
  const final = finalOf(detail);
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] border border-line bg-surface p-5">
      {final ? (
        <video
          key={m.stages.assemble?.finishedAt ?? ""}
          src={`${fileUrl(m.runId, final)}?v=${encodeURIComponent(m.stages.assemble?.finishedAt ?? "")}`}
          poster={firstKey ? fileUrl(m.runId, firstKey) : undefined}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => setDims(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
          className="aspect-[9/16] w-full max-w-[270px] rounded-xl bg-black object-contain"
          aria-label="Final video 9:16"
        />
      ) : (
        <div className="flex aspect-[9/16] w-full max-w-[270px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-line-dash bg-placeholder text-[13px] text-dim">
          <Icon.Film className="text-soft" />
          [final.mp4 · 9:16]
          <span className="text-xs">{m.status === "running" ? "still generating" : "no final video"}</span>
        </div>
      )}
      <div className="font-mono text-xs text-muted">
        {[dims, outputs.assemble ? secs(outputs.assemble.seconds) : null, final ? "h264 + aac" : null].filter(Boolean).join(" · ") || "—"}
      </div>
    </div>
  );
}

function Verbatim({ detail }: { detail: RunDetail }) {
  const qa = detail.outputs.qa;
  return (
    <Card title="Verbatim check" className="flex flex-col gap-3">
      {!qa ? (
        <p className="text-sm text-muted">Appears after the QA stage: ASR of the final video is compared with the script text.</p>
      ) : (
        <VerbatimBody expected={qa.expectedText} heard={qa.heardText} />
      )}
    </Card>
  );
}

function VerbatimBody({ expected, heard }: { expected: string; heard: string | null }) {
  const d = heard != null ? diffWords(expected, heard) : null;
  const allOk = d ? d.expected.every((t) => t.ok) && d.heard.every((t) => t.ok) : false;
  const chip = (ok: boolean) => (ok ? "bg-ok-bg text-ok" : "bg-fail-bg text-fail underline decoration-wavy");
  return (
    <>
      <div className="text-xs text-muted">Expected (from the script)</div>
      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel px-3 py-2.5 text-sm">
        {d
          ? d.expected.map((t, i) => (
              <span key={i} className={t.ok ? "" : "rounded bg-fail-bg px-1 text-fail line-through"} title={t.ok ? undefined : "not heard"}>
                {t.word}
              </span>
            ))
          : expected}
      </div>
      <div className="text-xs text-muted">Heard (ASR of final.mp4)</div>
      {d ? (
        <div className={`flex flex-wrap gap-1 rounded-lg border bg-panel px-3 py-2.5 text-sm ${allOk ? "border-ok-bd" : "border-fail-bd"}`}>
          {d.heard.length === 0 && <span className="text-muted">(silence)</span>}
          {d.heard.map((t, i) => (
            <span key={i} className={`rounded px-1 py-px ${chip(t.ok)}`} title={t.ok ? undefined : "extra / different word"}>
              {normalizeWord(t.word)}
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-muted">ASR is not available for this preset.</div>
      )}
      <div className="text-[13px] text-muted">
        Compared after normalisation (case, punctuation). Any mismatch fails QA.
        {d && !allOk && <span className="text-fail"> Mismatches are in red.</span>}
      </div>
    </>
  );
}

function QaChecks({ detail }: { detail: RunDetail }) {
  const qa = detail.outputs.qa;
  return (
    <Card
      title={
        <span className="flex items-center justify-between gap-2">
          QA checks
          {qa && <Badge tone={qa.pass ? "done" : "qa"}>{qa.pass ? "pass" : "fail"}</Badge>}
        </span>
      }
      className="flex flex-col"
    >
      {!qa && <p className="text-sm text-muted">Not run yet.</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {qa?.checks.map((c) => (
          <li key={c.name} className="flex justify-between gap-3 border-t border-line-soft py-1.5 text-sm">
            <span className="text-soft">
              <span className="sr-only">{c.pass ? "Passed: " : "Failed: "}</span>
              {c.name}
            </span>
            <span className={`text-right font-mono text-[13px] ${c.pass ? "text-ok" : "text-fail"}`} title={`expected: ${c.expected}`}>
              {c.value}
              {!c.pass && <span className="block text-xs text-muted">expected {c.expected}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
