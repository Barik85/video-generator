# 0003. Temporal as a second runner; the in-process runner stays the default

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

The PoC was built on its own in-process runner (`packages/core/src/runner.ts`): a loop over the stages, with all state in the run folder (`manifest.json`, `events.jsonl`, artifacts). Its limits showed up in practice:

- **If the process dies, the run stops.** Someone has to notice and run `resume`.
- **Re-submitting a video job costs money.** One clip takes 1.5–4 min. To avoid paying twice, a poll timeout was made a permanent error. A crash during generation lost the job, and the retry paid for a new one.
- **Nothing can pause a run** for a human decision, so the human-in-the-loop checkboxes in the UI are marked "soon".
- **No history view** beyond `events.jsonl`.

This record covers the implementation. Choosing an orchestration framework for the production stack is part of the test-task note and is argued there, not here.

## Decision

1. **Add a second runner on Temporal** (`packages/temporal`), selected with `--runner temporal` or `REEL_RUNNER=temporal`, in both the CLI and the API.
2. **The in-process runner stays the default.** It needs nothing installed, and "one command → video file" is a hard requirement of the task.
3. **Both runners call the same core steps:** `prepareResume`, `beginRun`, `executeStage` and `finishRun`. The workflow decides only the order and the retries. Stages, providers, schemas and the run folder stay unchanged.
4. **Without `TEMPORAL_ADDRESS`, the Temporal runner starts a throwaway dev server and a worker inside the process**, so it also works with one command. With `TEMPORAL_ADDRESS`, it connects to that server, and separate workers (`npm run temporal:worker`) do the work.

Two changes in the core benefit both runners:
- **Take-level reuse.** A video take that already exists on disk and passes the clip check is used again instead of being paid for.
- **Video job resume.** The OpenRouter video provider saves the job id next to the output file. The next attempt waits for that job instead of submitting a new one. The file is removed when the clip is downloaded or the job fails for good.

## Workflow shape

| Activity | Timeouts | Retries |
|---|---|---|
| `prepareRun` (validate preset, reopen for resume) | 1 min | 5 |
| `runStage` (one stage; heartbeats every 10 s) | start-to-close 6 h, heartbeat 2 min | 3, 30 s → 60 s; `PermanentError` is non-retryable |
| `finishRun` (final status from QA) | 1 min | 5 |

- **Workflow id is the run id**, so Temporal refuses a second concurrent execution of the same run, and `resume` reuses the id.
- **Workflow arguments carry `runsRoot`**, so a worker does not need its own copy of that setting.

## Verified (2026-10-22, `mock-native` preset)

| Scenario | Result |
|---|---|
| One command, embedded dev server | done in ~11 s, including the server start |
| `REEL_MOCK_FAIL=video:4`: the stage exhausts its 3 inner retries | Temporal retried the stage after 30 s; the 5th call succeeded; run done |
| Budget $0.001 (permanent error) | stopped at once; no Temporal retry; nothing spent |
| Worker killed (`kill -9`) after shot 1 of 2, during shot 2 | 2 min 23 s later a second worker logged `video: Temporal retry, attempt 2`; shot 1 was reused from disk; only shot 2 was generated; run done |
| `resume --from video` on an existing workflow id | ran; both shots reused; final reassembled |
| API with `REEL_RUNNER=temporal` against an external server | run created from `POST /api/runs`, status `done` |
| Unit tests | the workflow's stage order equals the core's `STAGES`; a saved OpenRouter job is awaited, not resubmitted; a failed job is forgotten |

Not tested with paid providers: the job resume was checked against a stubbed OpenRouter API only.

## Consequences

- **Copied stage list.** The workflow cannot import `@reel/core`, because workflow code is bundled into a deterministic sandbox with no file system. The stage list is copied into `workflows.ts`, and a test keeps it equal to `STAGES`.
- **Shared disk.** Workers and the client must see the same `runs/` directory. Production would need object storage (S3/R2) behind `RunStore`.
- **Retries multiply.** Temporal's stage retries sit on top of the in-stage provider retries: up to 3 × 3 attempts of one provider call. The per-run `--budget` check still bounds spend, and finished work is reused, but the worst case takes longer.
- **Crash detection is slow.** A dead worker is detected only after the 2-minute heartbeat timeout.
- **First-run download.** The embedded mode downloads the Temporal dev server binary on first use.

## Not done yet

- Human-in-the-loop via signals: approve the script and the keyframes before paying for video. The workflow would wait on a signal between stages, and the UI checkboxes would send it.
- Shots in parallel, as separate activities. Today one `runStage("video")` generates them one after another.
- Job resume for the fal.ai provider. Only OpenRouter saves its job id.

## Revisit when

- human approval or parallel shots are needed: both fit the workflow and not the in-process loop;
- runs move off a single machine: then a shared store becomes mandatory;
- "one command" stops being a requirement: then Temporal could become the default.
