import { createHash } from "node:crypto";
import type { RunStore } from "../run-store.ts";
import type { Providers } from "../providers/index.ts";
import type { RunInput, StageName } from "../schemas.ts";
import { BudgetExceededError, withRetry } from "../util/retry.ts";

export interface StageContext {
  stage: StageName;
  store: RunStore;
  providers: Providers;
  input: RunInput;
  log(type: string, message: string, data?: Record<string, unknown>): Promise<void>;
  /**
   * Wraps a paid provider call: refuses to start it if the estimate would break the budget,
   * retries transient failures, and books the actual cost.
   */
  paid<T extends { usd: number }>(what: string, estimateUsd: number, fn: (attempt: number) => Promise<T>): Promise<T>;
  /** Deterministic per-run seed so re-runs of a stage are reproducible where the model allows it. */
  seed(key: string): number;
}

export function makeContext(stage: StageName, store: RunStore, providers: Providers): StageContext {
  const input = store.get().input;
  const log = (type: string, message: string, data?: Record<string, unknown>) => store.event(stage, type, message, data);
  return {
    stage,
    store,
    providers,
    input,
    log,
    async paid(what, estimateUsd, fn) {
      const spent = store.get().cost.totalUsd;
      if (spent + estimateUsd > input.budgetUsd) {
        throw new BudgetExceededError(`${what}: would spend ~$${estimateUsd.toFixed(2)} on top of $${spent.toFixed(2)}, budget $${input.budgetUsd}`);
      }
      const res = await withRetry(fn, {
        attempts: 3,
        onRetry: (err, attempt, delay) => log("retry", `${what}: attempt ${attempt} failed (${errMsg(err)}), retrying in ${Math.round(delay / 1000)}s`),
      });
      if (res.usd > 0) await store.addCost(stage, what, res.usd);
      return res;
    },
    seed(key) {
      return createHash("sha256").update(`${store.runId}:${key}`).digest().readUInt32BE(0) % 2 ** 31;
    },
  };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
