import type { ReactNode } from "react";
import { TONE_CLASS, type Tone } from "../lib/status.ts";

export function Card({ title, children, className = "", as: As = "section" }: { title?: ReactNode; children: ReactNode; className?: string; as?: "section" | "div" }) {
  return (
    <As className={`rounded-[14px] border border-line bg-surface p-5 sm:p-6 ${className}`} aria-label={typeof title === "string" ? title : undefined}>
      {title && <h2 className="mb-3.5 text-base font-semibold">{title}</h2>}
      {children}
    </As>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export const buttonClass = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-accent px-4 font-bold text-ground no-underline hover:bg-accent-hi hover:text-ground disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 text-fg hover:border-muted disabled:opacity-50",
};

export function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: "ok" | "warn" | "fail" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "fail" ? "text-fail" : "";
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-mono text-xl ${color}`}>{children}</div>
    </div>
  );
}

type IconProps = { size?: number; className?: string };
const svg = (size: number, className: string | undefined, stroke: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    {children}
  </svg>
);

export const Icon = {
  Logo: ({ size = 22, className }: IconProps) => svg(size, className, 2, <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 9l5 3-5 3z" /></>),
  Check: ({ size = 13, className }: IconProps) => svg(size, className, 3, <path d="M5 12l5 5 9-10" />),
  Retry: ({ size = 13, className }: IconProps) => svg(size, className, 2.6, <><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v5h-5" /></>),
  X: ({ size = 13, className }: IconProps) => svg(size, className, 3, <path d="M6 6l12 12M18 6L6 18" />),
  Lock: ({ size = 14, className }: IconProps) => svg(size, className, 2, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  Play: ({ size = 18, className }: IconProps) => svg(size, className, 2.2, <path d="M7 4l12 8-12 8z" />),
  Dot: ({ size = 13, className }: IconProps) => svg(size, className, 2, <circle cx="12" cy="12" r="3" fill="currentColor" />),
  Film: ({ size = 44, className }: IconProps) => svg(size, className, 1.6, <><circle cx="12" cy="12" r="10" /><path d="M10 8.5l5 3.5-5 3.5z" /></>),
};

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-xl border border-fail-bd bg-fail-bg px-4 py-3 text-sm text-fail">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
