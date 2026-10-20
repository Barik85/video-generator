/** Thrown for failures that retrying the same call cannot fix (bad input, auth, content policy). */
export class PermanentError extends Error {}

/** Thrown when the run would exceed its spend cap. Never retried. */
export class BudgetExceededError extends PermanentError {}

export interface RetryOptions {
  attempts: number;
  baseDelayMs?: number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void | Promise<void>;
}

/** Exponential backoff with jitter for transient provider errors (network, 429, 5xx, timeouts). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const base = opts.baseDelayMs ?? 2000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err instanceof PermanentError || attempt === opts.attempts) throw err;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      await opts.onRetry?.(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Best-effort classification of HTTP-ish errors from SDKs. */
export function isPermanentHttpError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
