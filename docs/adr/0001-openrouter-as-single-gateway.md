# 0001. All model calls go through OpenRouter

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The pipeline was first built on fal.ai for media and the Anthropic API for the script (presets `seedance-fast` and `seedance-2.5`). The client then asked to use OpenRouter. They issued one key with a $20 limit that expires on 2026-10-24 at 06:21 UTC. About $6.45 had already been spent from it when we received it.

What OpenRouter offers through one key (catalog checked on 2026-10-21):

| Need | Endpoint | Model we use |
|---|---|---|
| Script | `/chat/completions` with `response_format: json_schema` | `anthropic/claude-opus-5.5` |
| TTS | `/audio/speech` | `elevenlabs/eleven-v3` (retry: `eleven-multilingual-v2`) |
| ASR | `/audio/transcriptions` | `elevenlabs/scribe-v2` |
| Keyframes | `/images` | `bytedance-seed/seedream-5-0-flash` |
| Video | `/videos` (async job, then poll, then `/content`) | Seedance 2.0 Fast, Veo 3.1 Lite, Kling v3 Std |

## Decision

Add an OpenRouter provider (`packages/core/src/providers/openrouter.ts`) and the `or-*` presets. Keep the fal and Anthropic providers. They sit behind the same interfaces, so switching back is a preset change.

## What we learned while integrating (all measured)

- **Seedance through OpenRouter is about 2.6× cheaper than through fal.** It measured **$0.0917/s** at 720p 9:16 (4 s → $0.367, 5 s → $0.457, 6 s → $0.548), against $0.2419/s on fal. Billing is in tokens, `w·h·24·s/1024`, which works out to 21,600 tokens/s at 720×1280.
- **Kling v3 Std bills a 5 s minimum.** A 3 s shot cost $0.63 (= 5 s × $0.126). Its `minSeconds` is set to 5.
- **Veo 3.1 Lite rejects a first frame with a photoreal person.** The error was "input image violates Vertex AI's usage guidelines", support code 15236754, and it happened even with the passthrough `personGeneration: allow_adult`. Rejected jobs are not billed. This rules Veo out for our image-to-video flow while keyframes show photoreal characters.
- **Inputs.** Images can be sent inline (`data:` URL). Audio references need **HTTPS URLs only**: the API returned "Only HTTPS URLs are allowed". With no bucket of our own, the audio goes to a throwaway host: Litterbox, or tmpfiles.org as the fallback (both delete after about an hour). The user approved both. Both failed several times (500/501) before an upload succeeded, so production needs its own bucket (S3/R2) with signed URLs.
- **Cost accounting.** We book `usage.cost` from the responses, and what we booked matched the key's `usage` to the cent on the first runs. Each paid call is checked against the run's `--budget` before it starts.
- **Generation time.** One Seedance or Kling clip takes 1.5–4 minutes. Shots are generated one after another, so a 3-shot run takes 7–12 minutes.
- **Scribe and event tags.** Through OpenRouter, Scribe adds audio-event tags ("[rain falling]") that cannot be switched off. They are stripped before WER (`normalizeWords`), and a test covers this.

## Consequences

- One key and one bill. The trade-off is that OpenRouter's catalog and limits apply on top of each model's own: HTTPS-only audio references and moderation through Vertex.
- The throwaway file host is a known weak spot. It is acceptable for the PoC, but not for production.
- Not implemented: generating shots in parallel. It would cut wall time about 3×, but it makes budget control and resume more complex.

## Revisit when

- the client's key expires (2026-10-24) and the provider has to be chosen again;
- a bucket for file inputs becomes available, at which point the throwaway hosts should be replaced.
