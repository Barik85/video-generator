import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { eventsUrl, type RunEvent } from "./api.ts";

export type StreamState = "connecting" | "live" | "ended" | "error";

/**
 * Subscribes to the run's SSE stream. The server replays the whole events.jsonl first, so the list
 * is rebuilt on every (re)connect. Each event also invalidates the run query, so manifest-derived
 * UI (stage statuses, cost, outputs) refreshes as the run progresses.
 *
 * `generation` forces a reconnect, e.g. after "resume" on a run whose stream already ended.
 */
export function useRunEvents(runId: string, generation: number) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<StreamState>("connecting");

  useEffect(() => {
    setEvents([]);
    setState("connecting");
    const es = new EventSource(eventsUrl(runId));
    let pending: RunEvent[] = [];
    let raf = 0;
    // batch replayed events into one render per frame
    const flush = () => {
      raf = 0;
      const batch = pending;
      pending = [];
      setEvents((prev) => prev.concat(batch));
      void qc.invalidateQueries({ queryKey: ["run", runId] });
    };
    es.onopen = () => setState("live");
    es.addEventListener("run", (e) => {
      try {
        pending.push(JSON.parse((e as MessageEvent<string>).data) as RunEvent);
        if (!raf) raf = requestAnimationFrame(flush);
      } catch {
        /* ignore malformed line */
      }
    });
    es.addEventListener("end", () => {
      es.close();
      setState("ended");
      void qc.invalidateQueries({ queryKey: ["run", runId] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    });
    es.onerror = () => {
      // EventSource retries by itself while CONNECTING; CLOSED means it gave up
      if (es.readyState === EventSource.CLOSED) setState("error");
      else setState("connecting");
    };
    return () => {
      es.close();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [runId, generation, qc]);

  return { events, state };
}
