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

Provider keys come from the repo-root `.env` (loaded by `apps/api/src/load-env.ts`). Presets whose
keys are missing are disabled in the form, and `POST /api/runs` rejects them with 400.

Env: `RUNS_DIR` (default `<repo>/runs`), `PORT` (api, default 8787), `REEL_RUNNER=core|temporal|fake`,
`API_URL` (proxy target for Vite).

Checks: `npm run typecheck:ui`, `npm run build:ui`.

## Screens

- **New run** (`/`) — idea, duration 8/15/20/30 s, preset (list comes from `PRESETS` via
  `GET /api/meta`, which also reports missing keys; default `mock-native`), budget, review checkpoints; live cost estimate (price table in `src/lib/pricing.ts`, the only place
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
- Human-in-the-loop: the New run form can pause the run after the script and/or the keyframes.
  The run page then shows a review card (approve, redo with a note, reject), and the run list shows
  "Needs review". Not available with `REEL_RUNNER=fake`.
- With the default runner, runs execute as in-process promises inside the API. If the API restarts,
  a run stays “running” on disk (the list shows "Interrupted?" after 10 min without updates) and
  can be continued with “resume”; a run paused for review is asked again. With
  `REEL_RUNNER=temporal` the stages run on a Temporal worker and the API only starts workflows and
  sends review signals.
- No auth, no DB: the `runs/` folder is the database.
