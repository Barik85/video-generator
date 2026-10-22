# Reel — idea → vertical video

Command-line pipeline that turns a 1–3 sentence idea into a 9:16 video of 8–30 s, with the dialogue line spoken word for word.

```bash
npm install
npm run reel -- run --idea 'A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: "You know what is inside. Do not open it until morning."' --seconds 15 --preset or-seedance-native --budget 3
# → runs/<runId>/final.mp4
```

Requirements: Node ≥ 22 and `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`). Keys go in `.env` (see `.env.example`):

| Key | Presets | Used for |
|---|---|---|
| `OPENROUTER_API_KEY` | `or-*` | everything through one key: Claude Opus 5.5 (script), ElevenLabs v3 (TTS), Scribe v2 (ASR), Seedream 5.0 Flash (keyframes), Seedance 2.0 Fast / Veo 3.1 Lite / Kling v3 (video) |
| `ANTHROPIC_API_KEY` + `FAL_KEY` | `seedance-fast`, `seedance-2.5` (legacy) | the first version: Claude direct plus fal.ai, lip-sync only |

The `mock` and `mock-native` presets (the default is `mock`) need no keys. They run the same orchestration, state, assembly and QA code with offline stand-ins: ffmpeg gradients for the picture and macOS `say` for the voice.

### How the line gets into the video

**Default: native audio** (`or-seedance-native`, then `or-kling-native`). The line goes into the video prompt in quotes and the model speaks it itself. Every take is transcribed and regenerated on a mismatch (`REEL_VIDEO_TAKES`, default 3); the clip's own audio is the soundtrack. The closest take is kept, and QA fails the run if it is still not verbatim. All English dialogue shots in `examples/` passed on the first take.

**Fallback: TTS lip-sync** (`or-seedance-lipsync`). The line is spoken by ElevenLabs TTS, checked by ASR, and passed to Seedance as `@Audio1`; the TTS track is the final soundtrack. The words are guaranteed before any video spend, and a retry costs cents instead of a clip. It is kept only for lines native audio cannot say verbatim: non-English (Ukrainian drifted toward Russian in 3 paid takes), rare names, numbers. Known problems from real runs:
- the voice sounds dry and detached from the scene: no room tone, rain or reverb;
- the voice is picked by gender only, so a six-year-old boy got an adult male voice.

Switching to the fallback is manual for now: re-run with the lip-sync preset. Why and how this was decided: [ADR 0002](docs/adr/0002-dialogue-audio-native-first.md).

`seedance-fast` and `seedance-2.5` are the first version of the pipeline (Claude direct plus fal.ai, lip-sync only). They are kept as legacy and need `ANTHROPIC_API_KEY` + `FAL_KEY`; [ADR 0001](docs/adr/0001-openrouter-as-single-gateway.md) explains the move to OpenRouter.

## Commands

```bash
npm run reel -- run --idea "..." [--seconds 15] [--preset or-seedance-native|or-kling-native|mock-native|mock|or-seedance-lipsync|...] [--budget 8] [--runner local|temporal] [--review script,keyframes]
npm run reel -- review <runId> approve|redo|reject [--note "..."]   # answer a paused run (Temporal server)
npm run reel -- resume <runId> [--from video]   # continue after a failure, or redo from a stage
npm run reel -- ls
npm run reel -- show <runId>
npm test
```

## Web UI

```bash
npm run dev:ui      # API on :8787 + web on http://localhost:5173 (stop with Ctrl+C)
```

1. **New run:** write the idea (put the line in quotes), pick the length, the preset and the budget. Presets whose keys are missing from `.env` are greyed out and say which key they need; the default `mock-native` is free. For a real video use `or-seedance-native`.
2. **Human-in-the-loop checkpoints:** tick "script" and/or "keyframes" to pause the run there. The form also shows the equivalent CLI command.
3. **Run page:** the stages update live. At a checkpoint a card asks for a decision: **Approve**, **Redo with note** (the note goes into the prompt) or **Reject and stop**. The run list shows such runs as "Needs review".
4. When the run is done the page has the player, the verbatim check (script vs ASR), the QA checks and the cost against the budget. A failed run can be continued with "resume from stage".

The API reads the same `.env` as the CLI. With the default runner the run lives inside the API process: if you restart `dev:ui` mid-run, open the run and press resume. More in [apps/web/README.md](apps/web/README.md); for the Temporal variant see below.

## Pipeline

```
idea ─► script ─► voice ─► plan ─► keyframes ─► video ─► assemble ─► qa ─► final.mp4
        (LLM)     (TTS+ASR) (timing) (image)     (Seedance) (ffmpeg)  (probe+ASR)
```

| Stage | Produces | Guards |
|---|---|---|
| script | `script.json`: characters, lines, 1–3 shots | JSON schema (structured output) and a semantic validator. A quoted line must appear verbatim, every line is used once, one speaker per shot. Errors go back to the model; up to 3 attempts. |
| voice | `voice/<line>.wav` | Each line is transcribed by ASR and compared to the text (WER). A mismatch triggers a re-record before any money goes to video; up to 3 takes. |
| plan | `plan/<shot>.wav`, shot lengths | Shot lengths are computed from measured audio, not the LLM's guess. Whole seconds within the model's limits, or its fixed lengths (Veo: 4/6/8 s); total fits 8–30 s. |
| keyframes | `keyframes/<shot>.png` | The same character `look` text is used in every prompt. |
| video | `video/<shot>.mp4` | lipsync: keyframe → `@Image1`, the shot's dialogue track → `@Audio1`. native: keyframe → first frame, the line quoted in the prompt, and each take is checked by ASR. A clip that is broken or too short counts as a failure and is retried. Each shot is saved as soon as it is ready. |
| assemble | `final.mp4` | Concat, 720×1280, loudness normalised. lipsync: **the soundtrack is the verified TTS track, never speech generated by the video model.** native: each clip's own ASR-checked audio. |
| qa | `qa.json` | Checks duration, resolution and the audio stream, then runs ASR on the final file and compares it to the script (WER). |

**State.** Each run is a folder `runs/<runId>/` containing `manifest.json` (per-stage status, attempts, errors, cost), `events.jsonl` (an append-only log the UI can tail) and every artifact. Stages exchange data only through these files. That makes `resume` cheap: it never re-bills a finished stage or a finished shot.

**Errors.** Transient provider failures (network, 429, 5xx, bad clip) are retried 3 times with exponential backoff. Permanent ones (validation, auth, policy, budget) stop the run at once with a clear message and a `resume` command. Content failures (paraphrased script, misheard TTS) are retried with feedback or different settings. Every paid call first checks the run's `--budget`.

**Nothing finished is paid for twice.** Every shot and every video take is saved as soon as it is ready and reused on a retry or `resume`. A submitted OpenRouter video job writes its id next to the output file (`<take>.raw.mp4.job.json`). If the process dies while the job is generating, the next attempt keeps waiting for that same job instead of submitting a new one.

## Human review (optional)

A run can pause for a person after the script and/or after the keyframes, before money goes to the next stage. The reviewer approves, sends the stage back with a note (it runs again with the note in the prompt and is shown again), or rejects the run.

```bash
npm run reel -- run --idea "..." --review script,keyframes
#   ⏸  script ready for review   (title, characters, shots and lines are printed)
#   [a]pprove · [r]edo with a note · [x] reject >
```

- **Where to answer.** In the terminal that started the run, or on the run's page in the UI (New run → "Human-in-the-loop checkpoints"). With a Temporal server, also from anywhere with `npm run reel -- review <runId> approve|redo|reject --note "..."`.
- **What a redo does.** The script stage gets the previous script plus all notes. The keyframes stage gets the notes in the image prompt and a new seed.
- **What is recorded.** Every decision goes into `manifest.json` (`reviews`), and the wait is in `awaitingReview`. A resumed run asks again unless the current output was already approved.
- **Runner differences.** On Temporal the wait is a workflow waiting for the `review` signal. It survives restarts, and a run with no answer for 7 days is rejected. On the in-process runner the wait lives in that process: after a restart, `resume` the run and it asks again.

## Runners: in-process or Temporal

The stages are the same either way; only the orchestration differs. Both runners call the same core steps (`beginRun`, `executeStage`, `finishRun` in `packages/core/src/runner.ts`) and keep all state in the run folder.

| | `--runner local` (default) | `--runner temporal` |
|---|---|---|
| Where stages run | inside the CLI or API process | as activities of the `reelRun` workflow on a Temporal worker (`packages/temporal`) |
| Process dies mid-run | the run stops; continue it with `resume` | another worker picks the stage up after the 2-minute heartbeat timeout and retries it; finished shots, takes and pending video jobs are reused |
| Whole-stage retries | none (provider calls retry inside the stage) | up to 3 per stage, 30 s → 60 s backoff; permanent errors are not retried |
| Run history | `events.jsonl` | `events.jsonl` plus the Temporal UI |
| Needs | nothing | nothing extra for one command (see below), or a Temporal server and a worker |

```bash
# One command: starts a throwaway Temporal dev server and a worker inside the CLI process
# (the dev server binary is downloaded by the SDK on first use)
npm run reel -- run --runner temporal --idea "..." --preset mock-native

# Separate server and worker, as in production
npm run temporal:server     # localhost:7233, UI on http://localhost:8233, history in .temporal/dev.db
npm run temporal:worker     # any number of these; each needs the same disk as the client (runs/)
TEMPORAL_ADDRESS=localhost:7233 npm run reel -- run --runner temporal --idea "..."
TEMPORAL_ADDRESS=localhost:7233 npm run reel -- resume <runId> --from video --runner temporal

# Web UI on Temporal
TEMPORAL_ADDRESS=localhost:7233 npm run dev:ui:temporal
```

`REEL_RUNNER=temporal` makes Temporal the default for both the CLI and the API. The workflow id is the run id, so Temporal refuses to execute the same run twice at once.

To see a worker crash handled: start the server, a worker with `REEL_MOCK_VIDEO_MS=15000` (each mock clip then takes 15 s), and a `mock-native` run. Kill the worker once the first shot is ready, and start another worker. About 2 minutes later the log shows `video: Temporal retry, attempt 2`, then `video s1: already on disk from an earlier attempt, reused`, and the run finishes.

## Decisions and examples

- `docs/adr/` explains why the pipeline is shaped this way: [0001](docs/adr/0001-openrouter-as-single-gateway.md) covers OpenRouter as the single gateway, [0002](docs/adr/0002-dialogue-audio-native-first.md) covers native audio with an ASR check, with TTS lip-sync as the fallback, and [0003](docs/adr/0003-temporal-as-second-runner.md) covers Temporal as a second runner next to the in-process one.
- `examples/` holds the generated videos, named by model, with cost and WER for each.
