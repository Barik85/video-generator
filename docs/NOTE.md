# Reel: idea → vertical video. Test-task note

## Part 1. Stack

How the choice was made:

1. **Prices first, collected with AI.** An AI agent gathered the prices and limits of the models and aggregators (`docs/research/facts.md`). Also checked by visiting Ai aggregator sites what they propose.
2. **Then the PoC.** It started on a small in-process runner.
3. **The orchestrator came last.** Temporal was chosen only after checking the generated videos and seeing how the pipeline behaves on real runs. In the repo it is the second runner (`--runner temporal`); the in-process runner stays the default, for one-command runs.

Why temporal? - The pipeline has long paid steps so when it crashes it should restart from the step where it stoped. A simple task queue isn’t enough for that. I needed durable execution, and Temporal is the most mature option. Temporary errors are retried with backoff, while permanent ones (like hitting the budget cap) fail right away. The workflow id is the run id, so the same run can’t start twice. I get run history in the Temporal UI without writing any extra code. The core pipeline doesn’t depend on Temporal. Both runners use the same `executeStage`, so I can drop Temporal without rewriting anything.

## Alternatives rejected


| Option                                    | Why not                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Own runner only** (manifest + `resume`) | Fine for the PoC, and it stays the default. Going further means building dead-process detection, restarts, timers for human waits, and distribution across machines: in effect, a home-made Temporal.       |
| **Queue (BullMQ + Redis, SQS)**           | A queue gives "run this task", not "continue a multi-step process where it stopped". State between steps, a 7-day wait on a signal, and compensation would all live in a database and be written by hand.   |
| **Inngest / Trigger.dev**                 | Closest in spirit (durable steps, TS-first) and easier to start with. Trigger.dev: checkpoints, warm starts and auto-scaling are Cloud-only; Inngest: the server is SSPL-licensed. A real option for a PoC. |
| **AWS Step Functions**                    | AWS lock-in, logic in JSON/ASL rather than code, awkward local testing. It cannot meet the "one command, offline, on mocks" requirement.                                                                    |
| **Airflow / Prefect / Dagster**           | Built for scheduled batch and data pipelines. User-triggered interactive runs with human waits are a poor fit, and they are Python while this stack is TypeScript.                                          |
| **Restate / DBOS**                        | Same model, lighter to operate. But a smaller ecosystem and less production track record.                                                                                                                   |


## Part 2. Data flow

```
idea ─► script ─► voice ─► plan ─► keyframes ─► video ─► assemble ─► qa ─► final.mp4
        LLM       TTS+ASR   timing   image        video    ffmpeg      probe+ASR
          ⏸ review               ⏸ review
```

Every stage reads the JSON outputs of the earlier stages and writes one JSON of its own, plus media files. Each output is checked against a zod schema (`packages/core/src/schemas.ts`).

Only four steps are generative: the script, TTS, the keyframes and the video. All media handling around them is deterministic ffmpeg/ffprobe code with no model involved:

- trimming and measuring the voice lines;
- building the per-shot dialogue tracks;
- normalising each clip to 720×1280, 24 fps and the exact length;
- extracting audio for the ASR checks;
- the final concat, `loudnorm` to −14 LUFS and H.264/AAC encoding.

Timing, format and assembly are therefore reproducible, and anything random comes only from the models.


| Stage         | Artifact                         | Key fields                                                                                                                                                                                    |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| script        | `script.json`                    | `characters[] {id, look, voice}` (`look` is reused word for word in every image and video prompt), `lines[] {id, characterId, text}`, `shots[] {visual, camera, lineIds}`, 1–3 shots, `style` |
| voice         | `voice.json`, `voice/<line>.wav` | per line: `seconds`, `asrText`, `attempts`                                                                                                                                                    |
| plan          | `plan.json`, `plan/<shot>.wav`   | per shot: whole `seconds`, `cues[] {lineId, at}`. Lengths come from the measured audio, not the LLM's guess.                                                                                  |
| keyframes     | `keyframes.json`, `<shot>.png`   | `seed`, `attempts`                                                                                                                                                                            |
| video         | `video.json`, `video/<shot>.mp4` | `seed`, `attempts`, `wer` of the chosen take, `audio`                                                                                                                                         |
| assemble / qa | `final.mp4`, `qa.json`           | `checks[] {name, pass, value, expected}`, `expectedText`, `heardText`, `wer`                                                                                                                  |


**State.**

- **The run folder is the state.** One folder per run, `runs/<runId>/`. It holds `manifest.json`, the only source of truth: status, attempts and errors per stage, every cost line, review decisions, `pipelineVersion`. It also holds `events.jsonl`, an append-only log that the CLI prints and the UI streams over SSE, and every artifact.
- **Stages share nothing in memory.** That is why the same steps run either in-process or as Temporal activities on another machine (ADR 0003), and why `resume` never pays twice for a finished stage, shot or take.
- **In production** the folder would become object storage for media (S3/R2) plus a database for the manifest and events. Episodes would get a shared character bible, so faces and voices stay the same across shots and series.

**Errors.**


| What went wrong                                                 | What happens                                                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient failure (network, 429, 5xx, broken or too-short clip) | 3 retries with backoff inside the stage. On Temporal, also up to 3 retries of the whole stage.                                                                               |
| Permanent failure (validation, auth, content policy, budget)    | Stops at once, with a `resume` command in the message.                                                                                                                       |
| Bad content: script                                             | The semantic validator checks that a quoted line is copied verbatim, every line is used once and each shot has one speaker. Its errors go back to the LLM, up to 3 attempts. |
| Bad content: TTS                                                | Misheard by ASR, so the line is re-recorded before any video spend.                                                                                                          |
| Bad content: native video                                       | Every take goes through ASR and is regenerated on a mismatch, up to 3 takes. The closest take is kept, and QA fails the run rather than ship a paraphrase.                   |
| Process killed mid-generation                                   | The video job id is saved, so the next attempt waits for that same job instead of paying for a new one.                                                                      |
| Spend                                                           | Every paid call first checks the run's `--budget`.                                                                                                                           |
| Partial regeneration                                            | `resume --from <stage>`, a review redo, or a single shot regenerated while the others are reused.                                                                            |


**Not built yet.** The fallbacks are manual today: native → lip-sync when no take is verbatim, and Seedance → Kling on a provider outage (ADR 0002).

**Human in the loop.** Optional gates after **script** and **keyframes**: approve, redo with a note (the note goes into the prompt), or reject. They sit exactly before the expensive steps: a script fix costs cents, a video retake costs $0.4–0.6.

There are deliberately **no gates on video and assembly**. ASR and QA judge those automatically, and a person can still `resume --from video`.

One gap the real runs exposed: the voice has no gate, and in lip-sync mode a six-year-old boy got an adult TTS voice. The keyframes reviewer caught it only because the mismatch was obvious.

## Part 3. Metrics and evaluation

**When the result counts as achieved.** QA judges the final file, not the pipeline's own outputs.

- **Format:** 8–30 s, 720×1280, an audio stream.
- **Verbatim:** the final audio is transcribed again, and WER against the quoted line **of the idea** must be 0 (case and punctuation ignored).

A run either passes all of these or ends `failed`, and every failure records where it stopped.

**Technical metrics.** `npm run reel -- report` computes them from the run folders; it calls no model and costs nothing. Rows are grouped by pipeline version × preset:

- the share of runs that ended done;
- the share heard verbatim;
- the share of dialogue shots that passed on the first take;
- $/run, max$, and **$ per usable video** (failed runs included, because that is the real unit cost);
- work time per stage (time waiting for a reviewer excluded);
- retries per run;
- where runs stopped.

Production would add p95 latency and error rate per provider, and queue time.

**Content quality.**


|                       | Metric                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automated now         | WER vs the idea; length vs the target; format; loudness (normalised to −14 LUFS)                                                                                                                                                                                                                             |
| Can be automated next | Lip-sync offset (a SyncNet-style model). Character consistency across shots (face-embedding similarity). Prompt adherence of keyframes (a VLM judge with a rubric). Voice fits the character: the pitch check that told the adult voice (\~118 Hz) from the native child voice (\~242 Hz) can become a rule. |
| Stays manual          | Does it feel like a scene: acting, emotion, whether the voice suits the character, whether the cut works. `reel rate <run> 1-5 --note` stores a score that the report averages. Comparing two versions should be a blind A/B on the same case.                                                               |


**Eval process.**

- **Fixed set.** `evals/core.json` holds 8 ideas, each aimed at one way the line can fail: two speakers, a child, numbers and times, rare names, contractions, a 25-word line, no quotes at all.
- **Comparable runs.** `reel eval --preset … --max-usd …` runs the whole set and tags each run with its case. `PIPELINE_VERSION` is bumped on any change to prompts, models or stage logic.
- **Version comparison.** `reel report --eval core` puts versions side by side, as totals and as a case × version matrix.
- **Regression runs at two prices.** The mock presets check orchestration, timing and format for free on every change (CI). The paid set (about $9–12 for 8 cases, retakes included) runs only when prompts or models change. The bar: no case that passed before may fail, and$ per usable video must not grow unexplained.

**Current numbers** (real runs, version 0.1.0; the sample is small):


| Preset          | Runs | Result                                                                    | $ per usable video |
| --------------- | ---- | ------------------------------------------------------------------------- | ------------------ |
| Seedance native | 4    | 3 verbatim on the first take; the 4th, in Ukrainian, failed after 3 takes | $2.12              |
| Kling native    | 1    | verbatim                                                                  | $2.10              |


The paid eval on the core set has not run yet: it costs more than the remaining credit.

**First week vs later.**

- **First week:** QA as the hard gate, the report, the fixed set on mock in CI, a paid run on each prompt or model change, and manual 1–5 ratings.
- **Later:**
  - automated lip-sync, consistency and VLM judges, each validated against the manual ratings first;
  - a larger set grown from real failures;
  - a dashboard;
  - per-stage evals (for example, the script validator's pass rate over 50 ideas, which costs about $1 and needs no video).

## Part 5. Working with AI

**Tools.** Almost all code, docs and research came from **Claude Code** (Opus 5.5) in the terminal. The web UI was built by a background agent in its own git worktree and merged into `main`. 

**How the work was set up.** I did not write code line by line. I set the task, the constraints and the checks, and kept the agent inside them:

- **Typecheck and unit tests** after every change.
- **Free mock presets.** The whole pipeline, retries and the Temporal crash scenarios run offline, so the agent can verify its work without spending money.
- **Real runs only with my approval and a `--budget` cap.** The one key had $20 on it.
- **ADRs** for every decision that real runs changed.
- **Claude Code's own permission guard.** It refused to merge a PR without an explicit approval from me.

**Prompts and structured output for the agent's steps.**

- **The script schema is the prompt.** It is a zod schema whose `.describe()` texts are instructions to the model. It is sent as a strict JSON schema (`response_format: json_schema, strict`), so the shape is guaranteed by the API.
- **The rest is checked in code.** A semantic validator checks what the schema cannot: quoted lines copied character for character, each line used once, one speaker per shot. Its errors go back to the model, up to 3 attempts.
- **Downstream prompts are assembled from fields, not written by an LLM.** `look` is pasted word for word into every image and video prompt. Reviewer notes and the previous script are added on a redo.

**Where AI was wrong, and what changed:**


| What happened                                                                                                                                        | What was done                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| It built the first version on fal.ai + Anthropic direct and never looked at OpenRouter.                                                              | When I asked why, it admitted it had not researched OpenRouter. After a price comparison everything moved there (ADR 0001).                                                                                                              |
| It designed TTS + lip-sync as the main path because that guarantees the words.                                                                       | I watched the videos and judged it bad: synthetic, detached from the scene. Native audio with an ASR gate became the default (ADR 0002). It then still presented lip-sync as an equal option in the README and the UI until I asked why. |
| The voice schema had only `female`/`male`.                                                                                                           | A six-year-old boy got an adult voice. I caught it at review, before any video spend.                                                                                                                                                    |
| It reported the UI as working, but had only compiled it.                                                                                             | The API never loaded `.env`, so no real preset could run from the UI. I hit it on my first UI run.                                                                                                                                       |
| Smaller bugs it found and fixed itself through tests: a Temporal client replaying old events, missed early events, a test hanging under fake timers. | —                                                                                                                                                                                                                                        |


## What I cut and why

| Cut for speed | How I would do it properly |
|---|---|
| **State on local disk.** `runs/<id>/` holds everything; workers must share the disk. | Media in object storage (S3/R2), manifest and events in Postgres, behind the same `RunStore` interface. |
| **Shots run one after another** inside a single video activity. | One activity per shot, in parallel, each with its own retries and its own budget slice. |
| **Fallbacks are manual.** When native audio misses the words, the operator re-runs with lip-sync; there is no automatic switch to another model when a provider is down. | Automatic fallback chains per stage (native → lip-sync, Seedance → Kling), driven by the same ASR/QA verdicts. |
| **Characters are text only.** `look` is pasted into every prompt, and the voice is picked by gender only. | A character bible per series: reference images fed to the image and video models, a cast voice per character (age and timbre), reused across shots and episodes. |
| **One idea → one clip of 1–3 shots.** | A full episode script → scenes → shots, with continuity checks between scenes. |
| **Small eval.** 8 cases; the paid eval was not run (it costs more than the remaining credit); quality scores are manual only; `PIPELINE_VERSION` was not bumped until late. | The set in CI on mocks for every change, the paid set on every prompt or model change, a larger set grown from real failures, and automated judges calibrated against human scores. |
| **No auth, no tenants, no global spend control.** Only a per-run budget cap. | Users and projects, quotas, and spend tracked per project and per provider. |
| **No Ukrainian dialogue.** I deliberately did not try to make Ukrainian voicing work, so as to get a working result in English faster. The one native run in Ukrainian drifted toward Russian (ADR 0002), and I did not go further. | A Ukrainian eval set first. Then lip-sync with a Ukrainian TTS voice checked by ASR, made less dry (scene ambience under the voice), and native audio wherever a model proves it can say Ukrainian verbatim. |