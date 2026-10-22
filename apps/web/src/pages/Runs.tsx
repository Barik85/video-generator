import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type RunSummary } from "../lib/api.ts";
import { runStatus, type RunStatusView } from "../lib/status.ts";
import { formatDate } from "../lib/format.ts";
import { usd } from "../lib/pricing.ts";
import { Badge, ErrorBox, buttonClass } from "../components/ui.tsx";

type Filter = "all" | "running" | "done" | "failed";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
];

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.id === params.get("status"))?.id ?? "all") as Filter;
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: api.runs,
    // keep the list fresh while something is generating
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 3000 : false),
  });

  const rows = (runs.data ?? []).map((m) => ({ m, s: runStatus(m, m.active) }));
  const count = (f: Filter) => (f === "all" ? rows.length : rows.filter((r) => r.m.status === f).length);
  const visible = filter === "all" ? rows : rows.filter((r) => r.m.status === filter);

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pb-16 pt-7 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight">Runs</h1>
        <Link to="/" className={buttonClass.primary}>
          + New run
        </Link>
      </div>

      <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setParams(f.id === "all" ? {} : { status: f.id }, { replace: true })}
            className={`min-h-10 rounded-full border px-3.5 text-sm ${filter === f.id ? "border-accent bg-accent-bg text-fg" : "border-line-strong bg-ground text-soft hover:border-muted"}`}
          >
            {f.label} · {count(f.id)}
          </button>
        ))}
      </div>

      {runs.error && <ErrorBox error={runs.error} />}

      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">Run</th>
              <th scope="col" className="px-4 py-3 font-semibold">Idea</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Stage</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Duration</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Cost</th>
              <th scope="col" className="px-4 py-3 font-semibold">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {runs.isPending && (
              <tr className="border-t border-line-soft">
                <td colSpan={7} className="px-4 py-6 text-muted">Loading…</td>
              </tr>
            )}
            {runs.isSuccess && visible.length === 0 && (
              <tr className="border-t border-line-soft">
                <td colSpan={7} className="px-4 py-6 text-muted">
                  {rows.length === 0 ? "No runs yet. Start one, or seed demo runs: npm run fake-runs -w @reel/api" : "No runs with this status."}
                </td>
              </tr>
            )}
            {visible.map(({ m, s }) => (
              <Row key={m.runId} m={m} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Row({ m, s }: { m: RunSummary; s: RunStatusView }) {
  return (
    <tr className="border-t border-line-soft align-top">
      <td className="whitespace-nowrap px-4 py-3.5">
        <Link to={`/runs/${m.runId}`} className="font-mono text-[13px]">
          {m.runId}
        </Link>
        <div className="text-xs text-faint">{formatDate(m.createdAt)}</div>
      </td>
      <td className="max-w-[360px] px-4 py-3.5 text-soft">
        <span className="line-clamp-2">{m.input.idea}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3.5">
        <Badge tone={s.tone}>{s.label}</Badge>
      </td>
      <td className="max-w-[260px] px-4 py-3.5 text-[13px] text-muted">
        <span className="line-clamp-2">{s.stage}</span>
      </td>
      <td className="px-4 py-3.5 text-right font-mono text-[13px]">{m.input.targetSeconds} s</td>
      <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono text-[13px]">
        {usd(m.cost.totalUsd)}
        <span className="text-faint"> / {usd(m.input.budgetUsd)}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[12.5px] text-muted">
        v{m.pipelineVersion}
        <div className="text-faint">{m.input.preset}</div>
      </td>
    </tr>
  );
}
