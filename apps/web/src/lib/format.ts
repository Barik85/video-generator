export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "<1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export const secs = (n: number) => `${n.toFixed(1)} s`;

/** English plural: plural(2, ["attempt", "attempts"]) */
export const plural = (n: number, [one, many]: [string, string]) => (n === 1 ? one : many);
