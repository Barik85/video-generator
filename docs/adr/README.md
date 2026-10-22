# Architecture Decision Records

Short records of decisions that are not obvious from the code: what was decided, why, what it was measured against, and when to revisit it. One file per decision. A superseded record is not deleted; it gets a "Superseded by" link.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-openrouter-as-single-gateway.md) | All model calls go through OpenRouter | Accepted | 2026-10-21 |
| [0002](0002-dialogue-audio-native-first.md) | Dialogue audio: the video model speaks the line, an ASR check gates it, TTS lip-sync is the fallback | Accepted (fallback not implemented yet) | 2026-10-21 |

Raw data for these records: `docs/research/facts.md` (prices and limits from public sources) and `examples/README.md` (the runs behind the example videos). Each run's full state is in `runs/<runId>/` (gitignored, local only).

> These records are an engineering log for the repository. The Part 1 comparison and justification for the test-task note are written by the author separately, without AI.
