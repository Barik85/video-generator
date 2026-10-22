# 0002. Dialogue audio: the video model speaks the line, an ASR check gates it, TTS lip-sync is the fallback

- **Status:** Accepted. The automatic fallback to lip-sync is **not implemented yet** (see "Implementation status").
- **Date:** 2026-10-21

## Context

The task requires the dialogue line to be heard **word for word** in a 9:16 video of 8–30 s. There are two ways to get speech into the video:

| | **lipsync** (TTS-first) | **native** (the model speaks) |
|---|---|---|
| How | ElevenLabs TTS for the line, checked by ASR before any video spend. The track goes to Seedance as `@Audio1` for lip-sync. The final soundtrack is the TTS track. | The line goes into the video prompt in quotes, and the model voices it itself. Each take is checked by ASR and regenerated on a mismatch (up to `REEL_VIDEO_TAKES`, default 3). The final soundtrack is the model's own audio. |
| Presets | `or-seedance-lipsync`, `seedance-fast`, `seedance-2.5` | `or-seedance-native`, `or-kling-native`, `or-veo-native` |
| Guarantee of exact words | Strong: the text goes into TTS and is checked before video spend | Probabilistic: we can only detect a mismatch and pay for another take |
| Cost of a wrong-words retry | about $0.01 (TTS) | a full clip (about $0.37–0.55 for Seedance, $0.63+ for Kling) |

The original design (lipsync) chose the strong guarantee. This record is about why, after real runs, the default changed.

## Evidence

All runs went through OpenRouter on 2026-10-21. Scene: "A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: …". WER is computed against the script after normalisation.

| Run | Mode / model | Language | Takes on the dialogue shot | WER per take | Final | Cost | Human verdict |
|---|---|---|---|---|---|---|---|
| `run_20261021114221_2d8d` | native / Seedance 2.0 Fast | UK | 3 | 0.63 (heard as Russian) → 0.38 (mixed) → 0.13 ("do ranka" for "do ranku") | QA failed | $2.19 | — |
| `run_20261021160650_36ba` | native / Seedance 2.0 Fast | EN | 1 | 0 | pass, 13 s | $1.27 | **good** |
| `run_20261021161802_517b` | native / Kling v3 Std | EN | 1 | 0 | pass, 12 s | $2.10 | **good** |
| `run_20261021162650_dcd8` | native / Seedance 2.0 Fast, 2 speakers (rooftop scene) | EN | 1 + 1 | 0, 0 | pass, 15 s | $1.45 | — |
| `run_20261021164857_457b` | lipsync / Seedance 2.0 Fast + ElevenLabs v3 | EN | 1 | 0 | pass, 14 s | $1.36 | **bad: sounds synthetic, detached from the scene** |
| `run_20261021113901_b446` | native / Veo 3.1 Lite | UK | — | — | rejected by Vertex (photoreal person in the first frame) | $0.28 | — |

What the lipsync run showed:
- **`@Audio1` does drive the lips.** The pause between the two sentences sits at 2.34–2.72 s in our track and at 2.32–2.87 s in the model's raw audio. The mouth is closed before and after the line and moves during it. The model even re-voiced the line in its own raw audio ("You know what's inside. Do not open it until morning.").
- **The final file still sounds worse.** The soundtrack is a dry studio TTS with no rain, room tone or reverb. The voice is picked only by the character's gender. The person who reviewed the videos judged the native versions good and the lipsync one bad.

Added 2026-10-22, a scene with a six-year-old boy speaking ("A sunny wedding reception on a rooftop…"):

| Run | Mode / model | Takes | WER | Result | Cost |
|---|---|---|---|---|---|
| `run_20261022115820_a179` | lipsync / Seedance 2.0 Fast + ElevenLabs v3 | — | 0 (TTS) | rejected at the keyframes review: the boy got the adult male TTS voice (median pitch ~118 Hz), because the script's voice field is only `female`/`male` | $0.08 |
| `run_20261022120735_cfc7` | native / Seedance 2.0 Fast | 1 | 0 | pass, 15 s; median pitch ~242 Hz | $1.46 |

What the Ukrainian native run showed: Seedance's native speech in Ukrainian drifts toward Russian, and 3 paid takes ($1.37 on that one shot) did not produce a verbatim line. In English, 4 of 4 dialogue shots passed on the first take.

## Decision

1. **The default for English dialogue is native audio with an ASR verbatim check:** `or-seedance-native`, then `or-kling-native`. Naturalness is part of the bar ("does it sound like the scene"), not only exact words, and native passes both in English.
2. **The ASR check stays mandatory.** Native speech is probabilistic. Every take is transcribed, and only WER ≤ `REEL_MAX_WER` (default 0) passes. The final QA re-checks the assembled file.
3. **TTS lip-sync is the fallback, not the main path.** It is for lines the model cannot say verbatim within N takes: non-English lines, rare names, numbers.
4. **The dialogue language is English.** Ukrainian is out of scope for this PoC, because native audio is unreliable in it (see the evidence).
5. **Veo is off the table** while keyframes show photoreal people.

## Alternatives considered

- **Lip-sync everywhere (the original design).** Strongest guarantee of exact words, but it was judged unnatural. Rejected as the default.
- **Lip-sync plus the model's ambience under the TTS.** The model's raw audio already contains its own speech, so mixing it in doubles the voice. Separating speech from ambience would need a source-separation model, which is extra complexity and was not tried.
- **Lip-sync, then keep the model's re-voiced audio when ASR passes.** Promising: the scene acoustics come with lip-sync timing. In the one sample, though, the model said "what's" instead of "what is", which fails a strict verbatim check. Not tried beyond that one sample.
- **Native without an ASR check.** Cheaper, but nothing would catch a paraphrase. The Ukrainian run shows how bad it can get. Rejected.

## Consequences

- A wrong-words retry now costs a full clip, not cents. Spend is bounded per run by `--budget` and per shot by `REEL_VIDEO_TAKES`.
- When no take is verbatim, the closest take is kept and QA marks the run failed, rather than silently shipping a paraphrase.
- Voice consistency for one character across shots is not guaranteed in native mode, because each shot is generated independently. With one speaking shot per character it was not an issue in the examples.

## Implementation status

- Native mode, per-take ASR, the take limit and keeping the closest take: **implemented** (`packages/core/src/stages/video.ts`).
- Automatic **native → lipsync fallback** when no take is verbatim: **not implemented yet**. Today the run fails QA and the operator re-runs it with a lipsync preset.
- The CLI default preset is still `mock`. The real default has to be chosen explicitly with `--preset or-seedance-native`.

## Revisit when

- Dialogue must be in Ukrainian, or in another language where native speech fails. Then lipsync becomes the main path again, and its naturalness problem (dry TTS) needs a fix.
- Native first-take pass rates drop on a larger sample. Four English shots is a small sample.
- Seedance accepts a voice reference for native speech, which would fix voice consistency.
