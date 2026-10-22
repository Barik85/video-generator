import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReviewGate } from "../lib/api.ts";
import { estimate, modelFor, usd } from "../lib/pricing.ts";
import { lockedLines, shellQuote, words } from "../lib/text.ts";
import { plural } from "../lib/format.ts";
import { Card, ErrorBox, Icon, Spinner, buttonClass } from "../components/ui.tsx";

const DURATIONS = [8, 15, 20, 30] as const;
const DEFAULT_IDEA =
  'A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: "You know what is inside. Do not open it until morning."';

const HITL: Array<{ gate: ReviewGate; title: string; hint: string }> = [
  { gate: "script", title: "Approve the script before rendering", hint: "The cheapest checkpoint: a text fix costs cents, a video fix costs dollars." },
  { gate: "keyframes", title: "Approve the keyframes", hint: "Check the character and location before generating video." },
];

const choice = (selected: boolean) =>
  selected ? "border-accent bg-accent-bg text-fg font-semibold" : "border-line-strong bg-ground text-soft hover:border-muted";

export function NewRunPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity });
  const presets = meta.data?.presets ?? ["mock", "mock-native"];
  const missing = meta.data?.missingKeys ?? {};

  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [seconds, setSeconds] = useState<number>(15);
  const [preset, setPreset] = useState("mock-native");
  const [budget, setBudget] = useState("8");
  const [review, setReview] = useState<ReviewGate[]>(["script"]);
  const reviewSupported = meta.data?.runner !== "fake";

  const budgetUsd = Number(budget);
  const est = estimate(preset, seconds);
  const model = modelFor(preset);
  const locked = lockedLines(idea);
  const lockedWords = locked.reduce((a, l) => a + words(l).length, 0);
  const valid = idea.trim().length > 0 && Number.isFinite(budgetUsd) && budgetUsd > 0;

  const create = useMutation({
    mutationFn: () => api.create({ idea: idea.trim(), targetSeconds: seconds, preset, budgetUsd, review: reviewSupported ? review : [] }),
    onSuccess: ({ runId }) => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void navigate(`/runs/${runId}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !create.isPending) create.mutate();
  };

  const cli = `npm run reel -- run --idea ${shellQuote(idea.trim())} --seconds ${seconds} --preset ${preset} --budget ${Number.isFinite(budgetUsd) ? budgetUsd : 8}${review.length ? ` --review ${review.join(",")}` : ""}`;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-7">
        <h1 className="mb-1.5 text-[28px] font-bold tracking-tight">New run</h1>
        <p className="max-w-[680px] text-muted">
          A 1–3 sentence idea → script → vertical video of 8–30 s. Lines in "quotes" stay verbatim: nothing paraphrases them.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-start gap-6">
        <section aria-label="Run settings" className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <Card as="div" className="flex flex-col gap-3">
            <label htmlFor="idea" className="font-semibold">
              Idea
            </label>
            <textarea
              id="idea"
              rows={4}
              required
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="w-full resize-y rounded-[10px] border border-line-strong bg-ground p-3.5 leading-relaxed text-fg"
            />
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted" aria-live="polite">
              {locked.length > 0 ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-bd bg-accent-bg px-2.5 py-1 text-accent-hi">
                    <Icon.Lock />
                    {locked.length} locked {locked.length === 1 ? "line" : "lines"} · {lockedWords} {plural(lockedWords, ["word", "words"])}
                  </span>
                  <span>Voiced: {locked.map((l) => `"${l}"`).join(" ")}</span>
                </>
              ) : (
                <span>No quoted lines: the LLM will write the dialogue.</span>
              )}
            </div>
          </Card>

          <Card as="div" className="flex flex-col gap-[22px]">
            <div className="flex flex-col gap-2.5">
              <div className="font-semibold" id="dur-label">
                Duration
              </div>
              <div role="group" aria-labelledby="dur-label" className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={d === seconds}
                    onClick={() => setSeconds(d)}
                    className={`min-h-11 min-w-[72px] rounded-[10px] border px-4 ${choice(d === seconds)}`}
                  >
                    {d} s
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="font-semibold" id="preset-label">
                Preset (video model)
              </div>
              <div role="group" aria-labelledby="preset-label" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
                {presets.map((p) => {
                  const m = modelFor(p);
                  const sel = p === preset;
                  const needs = missing[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={sel}
                      disabled={!!needs}
                      title={needs ? `Needs ${needs.join(", ")} in .env` : undefined}
                      onClick={() => setPreset(p)}
                      className={`flex flex-col gap-1 rounded-xl border p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${sel ? "border-accent bg-accent-bg" : "border-line-strong bg-ground hover:border-muted"}`}
                    >
                      <span className="font-semibold text-fg">{m.name}</span>
                      <span className={`text-[13px] ${sel ? "text-accent-hi" : "text-muted"}`}>{m.how}</span>
                      <span className={`font-mono text-xs ${sel ? "text-soft" : "text-muted"}`}>
                        {p} · {m.price}
                      </span>
                      {needs && <span className="text-xs text-muted">needs {needs.join(", ")}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="budget" className="font-semibold">
                  Budget limit, $
                </label>
                <input
                  id="budget"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="min-h-11 rounded-[10px] border border-line-strong bg-ground px-3 text-fg"
                />
              </div>
            </div>
          </Card>

          <Card as="div" className="flex flex-col gap-3.5">
            <span className="font-semibold">Human-in-the-loop checkpoints</span>
            <p className="-mt-2 text-[13px] text-muted">
              {reviewSupported
                ? "The run pauses after the checked stages until you approve, send it back with a note, or reject it."
                : "Not available with the fake runner."}
            </p>
            {HITL.map((h) => (
              <label key={h.gate} className={`flex items-start gap-3 ${reviewSupported ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                <input
                  type="checkbox"
                  disabled={!reviewSupported}
                  checked={review.includes(h.gate)}
                  onChange={(e) => setReview((r) => (e.target.checked ? [...r, h.gate] : r.filter((g) => g !== h.gate)))}
                  className="mt-0.5 h-5 w-5 accent-accent"
                />
                <span>
                  <span className="block font-medium">{h.title}</span>
                  <span className="text-[13px] text-muted">{h.hint}</span>
                </span>
              </label>
            ))}
          </Card>
        </section>

        <aside aria-label="Estimate and launch" className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <Card as="div" className="flex flex-col gap-3.5">
            <div className="font-semibold">Cost estimate</div>
            <div className="flex flex-col gap-2 text-sm">
              {est.lines.map((l) => (
                <div key={l.label} className="flex justify-between gap-3">
                  <span className="text-muted">{l.label}</span>
                  <span className="font-mono">{usd(l.usd)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold">Expected</span>
              <span className="font-mono text-[22px] font-medium">{usd(est.total)}</span>
            </div>
            <div className="text-[13px] text-muted">
              With two retries the worst case is {usd(est.worst)}. The run stops as soon as it would exceed the limit.
            </div>
            {valid && est.total > budgetUsd && (
              <div className="rounded-lg border border-warn-bd bg-warn-bg px-3 py-2 text-[13px] text-warn">
                The estimate {usd(est.total)} is above the {usd(budgetUsd)} limit, so the run will likely stop before the end.
              </div>
            )}
            <button type="submit" disabled={!valid || create.isPending} className={`${buttonClass.primary} min-h-12 rounded-xl text-base`}>
              {create.isPending ? <Spinner /> : <Icon.Play />}
              Start run
            </button>
            {create.error && <ErrorBox error={create.error} />}
          </Card>

          <Card as="div" className="flex flex-col gap-3">
            <div className="font-semibold">What happens</div>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-soft">
              <li>Script + shot plan (JSON schema)</li>
              <li>TTS of each line (exact text)</li>
              <li>Character keyframes</li>
              <li>{model.step}</li>
              <li>Assembly: TTS track (lipsync) or the model's own audio (native)</li>
              <li>QA: ASR verbatim check, duration, format</li>
            </ol>
          </Card>

          <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-5">
            <div className="text-[13px] text-muted">Same from the CLI</div>
            <code className="whitespace-pre-wrap break-words font-mono text-[12.5px] text-soft">{cli}</code>
          </div>
        </aside>
      </form>
    </main>
  );
}
