export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "<1 с";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} хв ${s % 60} с`;
  return `${Math.floor(m / 60)} год ${m % 60} хв`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export const secs = (n: number) => `${n.toFixed(1)} с`;

/** Ukrainian plural: plural(2, ["спроба", "спроби", "спроб"]) */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
