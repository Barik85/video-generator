import { NavLink, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { Icon } from "./ui.tsx";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 no-underline ${isActive ? "bg-raised font-medium text-fg hover:text-fg" : "text-muted hover:text-fg"}`;

export function Layout() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity });
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-6 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5 text-base font-bold tracking-tight">
            <Icon.Logo className="text-accent" />
            Reel Studio
          </div>
          <nav aria-label="Main" className="flex flex-auto flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>
              New run
            </NavLink>
            <NavLink to="/runs" className={navClass}>
              Runs
            </NavLink>
            <span className="px-3 py-2 text-faint">Evals · later</span>
          </nav>
          <div className="flex items-center gap-2 font-mono text-xs text-muted">
            {meta.data?.runner === "fake" && (
              <span className="rounded border border-warn-bd bg-warn-bg px-1.5 py-0.5 text-warn" title="REEL_RUNNER=fake: simulated pipeline">
                fake runner
              </span>
            )}
            {meta.data?.runner === "temporal" && (
              <span className="rounded border border-line-strong px-1.5 py-0.5" title="REEL_RUNNER=temporal: stages run as a Temporal workflow">
                temporal
              </span>
            )}
            pipeline v{meta.data?.pipelineVersion ?? "…"}
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
