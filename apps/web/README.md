# Reel Studio — web UI

Vite + React 19 + TypeScript + Tailwind v4 + TanStack Query + react-router. Talks to `apps/api`
(Hono, port 8787) through the Vite dev proxy (`/api` → `http://localhost:8787`).

## Run

```bash
npm install                 # once, from the repo root
npm run fake-runs           # optional: seed 5 demo runs into ./runs (needs ffmpeg)
npm run dev:ui              # api :8787 + web :5173, real pipeline from @reel/core
npm run dev:ui:fake         # same, but new runs use the in-process simulator
```

Open http://localhost:5173.

Env: `RUNS_DIR` (default `<repo>/runs`), `PORT` (api, default 8787), `REEL_RUNNER=fake|core`,
`API_URL` (proxy target for Vite).

Checks: `npm run typecheck:ui`, `npm run build:ui`.

## Screens

- **New run** (`/`) — idea, duration 8/15/20/30 s, preset (list comes from `PRESETS` via
  `GET /api/meta`), budget; live cost estimate (price table in `src/lib/pricing.ts`, the only place
  prices live); the equivalent CLI command. Submitting creates the run and opens its page.
- **Run detail** (`/runs/:id`) — stage timeline driven by SSE (`/api/runs/:id/events`), cost vs
  budget, shots (keyframe + per-shot video, dialogue lines with audio), event log, final 9:16
  player + download, verbatim panel (script text vs ASR text with word-level diff), QA checks,
  artifact list, “resume from stage”.
- **Runs** (`/runs`) — table with status filter (`?status=running|done|failed`).

## What is mocked / not done

- `npm run fake-runs` writes schema-valid run folders through `RunStore` with placeholder media
  (ffmpeg gradients + sine tones), including a QA failure (WER), a budget stop and a run left
  "running". `REEL_RUNNER=fake` uses the same simulator for runs started from the UI; the
  header shows a “fake runner” badge then.
- Seedance 2.5 price is an estimate (Seedance 2.0 Standard rate) — no public price yet.
- Human-in-the-loop checkboxes are rendered disabled (“скоро”): the core has no approval gates.
- Runs execute as in-process promises inside the API. If the API restarts, a run stays “running”
  on disk (the list shows “Перервано?” after 10 min without updates) and can be continued with
  “resume”. Next step: a real queue + worker process; the API would only enqueue and serve files.
- No auth, no DB: the `runs/` folder is the database.
