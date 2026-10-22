# Research: raw facts for choosing the stack

> Collected 2026-10-20. 

## 1. Video generation

| Model | Where | Price | Audio | Duration / format | Notes |
|---|---|---|---|---|---|
| Veo 3.1 Standard | Gemini API | $0.40/s (720p/1080p), $0.60/s (4K) | native | 4–8 s | **Preview ID deprecated, shutdown 2026-10-22** (official pricing page) |
| Veo 3.1 Fast | Gemini API | $0.10 / $0.12 / $0.30 per s (720p/1080p/4K) | native | — | same, shutdown 2026-10-22 |
| Veo 3.1 Lite | Gemini API | $0.05 / $0.08 per s | native | — | same, shutdown 2026-10-22 |
| Veo 3.1 (`veo-3.1-generate-001`) | Vertex AI | — | native | — | GA; unverified reports say retirement "not before 2026-11-17" |
| Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`) | Gemini API | ~$0.10/s 720p (official); other resolutions only reseller estimates | native, dialogue | up to 10 s per generation, scene extension up to 40 s | Google calls it the replacement for the Veo 3.1 preview. No free tier |
| Kling v3 Pro (`fal-ai/kling-video/v3/pro/image-to-video`) | fal.ai | $0.14/s | audio variant available | 5/10 s, 9:16 | third-party sites list other v3 prices ($0.112–0.28/s) |
| Kling v3 Standard | fal.ai | $0.14/s (≈$0.63 per clip) | — | — | |
| Kling v2.5 turbo pro | fal.ai | $0.07/s | no | 5/10 s | |
| Kling O3 Pro / Standard | fal.ai | $0.14/s | — | — | |
| Seedance 2.0 Fast / Mini | fal.ai | tokens: ≈$1.21 / ≈$0.76 per 5 s | — | reference-to-video | |
| MiniMax H3 Max / Max Turbo | fal.ai | $0.05/s / $0.025/s | — | reference / image-to-video | |
| Grok Imagine Video | fal.ai | $0.05/s | — | — | |
| PixVerse V6 | fal.ai | $0.005/s (≈$0.225 per 5 s) | — | — | |
| Wan 2.5 / 3.0 | fal / Alibaba | $0.05/s (480p) … $0.15–0.20/s (1080p) | — | — | open weights, can be self-hosted |
| Sora 2 Pro | fal.ai | $0.30/s (720p) – $0.50/s (1080p) | native | — | |

### Seedance 2.0 (ByteDance) in detail

| Parameter | Value (fal.ai, `bytedance/seedance-2.0/...`) |
|---|---|
| Endpoints | text-to-video, image-to-video, reference-to-video; tiers Standard / Fast / Mini |
| Reference inputs | up to 9 images + 3 videos (2–15 s total) + 3 audio files (≤15 s total), ≤12 files overall. The prompt refers to them as `@Image1`, `@Video1`, `@Audio1`. Audio requires at least one image or video |
| Duration | `auto` or 4–15 s per generation |
| Format | 9:16 supported; 480p or 720p (1080p only on Standard, ~$0.68/s) |
| Audio | `generate_audio=true` by default: dialogue, SFX, ambience, lip-sync. **Audio costs nothing extra** |
| Price | Standard ~$0.30/s; Fast $0.2419/s (720p); with a video reference ×0.6 (~$0.145/s). Tokens: `h×w×(in_dur+out_dur)×24/1024`, $0.011–0.014 per 1K |
| Does uploaded audio drive the lips | The official fal page **does not document it**. Community guides suggest the prompt "use @Audio1 as her dialogue voice, sync lip movement", but warn "do not promise exact playback": the result is probabilistic and retakes are needed |
| Sync quality (ByteDance tech report) | English AV-sync 4.17/5; multi-person Chinese dialogue 3.86/5 (their own benchmark) |
| Languages | Mandarin best, English close; other languages weaker, sometimes with an English accent (field reports) |
| Practical tips from guides | locked medium close-up, no head turns during the line, drop music/SFX from the prompt when dialogue matters |

Known risks from reviews: "voice scrambling" and garbled on-screen text on complex prompts.

**Observation, not a judgement:** models with native audio generate the speech themselves, and **nothing guarantees the line is verbatim**. Models without audio need a separate TTS plus overlay or lip-sync.

## 2. TTS (voice)

| Model | Where | Price | Timings | Notes |
|---|---|---|---|---|
| ElevenLabs v3 / v4 / Multilingual v2 | ElevenLabs API | $0.08 per 1K characters (v3, v2, v4); Flash/Turbo $0.04 (after the 2026-10-05 price cut) | the `/with-timestamps` endpoint returns **per-character** alignment (`characters`, `character_start_times_seconds`, `character_end_times_seconds`) | `seed` exists, but determinism is not guaranteed. WAV 44.1 kHz only from the Pro plan |
| MiniMax Speech 2.8 HD / Turbo | fal.ai | $0.10 / $0.06 per 1K characters | — | |
| Gemini 3.1 Flash TTS | fal.ai | $0.05 per 1K characters | — | |
| Inworld TTS-1.5 Max | fal.ai | $0.01 per 1K characters | — | |
| xAI TTS | fal.ai | $0.015 per 1K characters | — | |
| Chatterbox | fal.ai / open source (MIT) | $0.025 per 1K characters | — | voice cloning from 7–10 s of audio |
| Kokoro | fal.ai / open source (Apache 2.0, 82M) | $0.02 per 1K characters | — | runs on CPU, 54 voices, no cloning |

TTS takes the text as input directly, so the words are fixed by the text itself. The risks are normalisation (numbers, abbreviations) and dropped or "swallowed" words.

## 3. Lip-sync (put given audio onto a generated video)

| Model | Where | Price |
|---|---|---|
| LatentSync (ByteDance) | fal.ai | $0.20 per video ≤40 s, then $0.005/s |
| sync lipsync 1.9 | fal.ai | $0.70/min |
| sync lipsync 2.0 / 2.0 Pro | fal.ai | $3/min / $5/min |
| sync.so (lipsync-1.9 … sync-3) | own API | $0.02/s … $0.133/s |

## 4. ASR (automatic check that the line was spoken verbatim)

| Model | Price | Word timestamps | WER (from different sources, not comparable) |
|---|---|---|---|
| ElevenLabs Scribe v2 | ~$0.22–0.27/h (batch) | yes, + diarization, keyterm prompting | FLEURS 93.5% accuracy (realtime) |
| Deepgram Nova-3 | from $0.0043/min (batch, English) | yes | 5.26% (vendor benchmark) |
| OpenAI gpt-4o-transcribe / mini | $0.36 / $0.18 per h | word-level only for `whisper-1` | ~8.9% (Artificial Analysis) |
| Whisper large-v3 | free (self-host, CPU/GPU) | yes (via faster-whisper / whisperx) | — |

## 5. LLM (idea → script → shot list, structured output)

| Model | Input $/1M | Output $/1M | Notes |
|---|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | structured outputs (`output_config.format`, `messages.parse`), 1M context |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | same |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 | ≤100K prompt tokens |
| Gemini 3.1 Pro Preview | $2 | $12 | |
| Gemini 3.8 Flash | $0.75 | $3.75 | prices double from 2027-01-01 |

A script for 8–30 s takes a few hundred tokens, so the LLM step costs next to nothing per video compared with the video itself.

## 6. Orchestration / state

| Tool | Type | What is known |
|---|---|---|
| LangGraph (1.2.x) | agent graph | checkpoints, pause/resume for human approval; the library is free, LangSmith is paid |
| Temporal | durable execution | survives worker crashes, multi-language, long (days) workflows; separate server |
| Inngest | durable steps, event-driven | managed infrastructure, strong in TS/JS |
| Prefect | workflow engine | added AI-agent primitives; no detailed comparisons found |
| Own step runner + file/SQLite state | — | no dependencies; durability = idempotent steps + artifacts on disk |

A classification seen in reviews: graph-based (LangGraph), role-based (CrewAI, OpenAI Agents SDK), durable execution (Temporal, Inngest).

## 7. Domain context

- In February 2026 Holywater Tech (My Drama) bought the AI VFX studio Jeynix and rebranded as AI-first. Fox Entertainment makes more than 200 vertical titles for My Drama.
- 2026 reviews of micro-drama tools: no single tool covers character consistency, editing continuity and dialogue sync at once, so tools are chained. Consistency comes from **reference images**, not from a separate prompt per shot.

## 8. Risks visible from the facts (not weighed)

- Veo 3.1 preview IDs shut down on 2026-10-22, so video model prices and IDs live for months.
- Prices for the same model differ between aggregators by up to 2×.
- Native audio in video models does not guarantee a verbatim line.
- TTS determinism is not guaranteed even with `seed`.

## 9. Same model, different aggregator (collected 2026-10-22)

OpenRouter prices were measured: the `usage.cost` of our runs on 2026-10-21. Replicate prices come from the billing tiers embedded in each model page. fal prices are from section 1. All prices are for 720p unless noted.

| Model | OpenRouter | Replicate | fal.ai |
|---|---|---|---|
| Seedance 2.0 Fast | $0.0917/s (tokens: `w·h·24·s/1024` × $0.0000042) | $0.15/s; $0.17/s with a video input; 480p $0.07 / $0.08 | $0.2419/s |
| Seedance 2.0 | $0.151/s (tokens × $0.000007) | $0.18/s; $0.22/s with a video input; 1080p $0.45 / $0.55 | ~$0.30/s |
| Kling v3 Standard | $0.126/s with audio, billed for at least 5 s | $0.168/s without audio, $0.252/s with audio | $0.14/s |
| Kling v3 Pro | — | $0.224/s without audio, $0.336/s with audio | $0.14/s |
| Veo 3.1 Lite | $0.05/s (with audio) | $0.05/s; 1080p $0.08 | — |
| Veo 3.1 Fast | $0.10/s | $0.10/s; $0.15/s (second tier, resolution not labelled) | — |
| ElevenLabs v3 (TTS) | $0.08 per 1K characters | $0.10 per 1K characters | — |
| ElevenLabs Scribe v2 (ASR) | $0.0000611/s (≈ $0.22/h) | $0.22/h | — |
| Claude Opus 5.5 | $4 / $20 per 1M tokens | $4 / $20 per 1M tokens | — |

Video cost of a 13 s clip at these rates:

| | OpenRouter | Replicate | fal.ai |
|---|---|---|---|
| Seedance 2.0 Fast | $1.19 | $1.95 | $3.14 |
| Kling v3 Std with audio | $1.64 | $3.28 | — |

Other facts:
- The Replicate Seedance 2.0 Fast page lists a first frame (and optional last frame), up to 3 audio references (`[Audio1]`…) and native audio.
- OpenRouter accepts audio references only as HTTPS URLs ("Only HTTPS URLs are allowed"). Not checked: whether Replicate's Seedance accepts uploaded files or data URIs for audio.
- Not checked: OpenRouter's fee on credit purchases, which is not included in per-model prices.

## Sources

- [Gemini API pricing (official, updated 2026-10-19)](https://ai.google.dev/gemini-api/docs/pricing)
- [Veo 3.1 preview deprecation / Omni](https://ai.google.dev/gemini-api/docs/veo), [Gemini Omni](https://gemini.google/overview/video-generation/), [reliant PR #731](https://github.com/reliant-labs/reliant/pull/731)
- [Gemini Omni 1.1 Flash pricing (eesel)](https://www.eesel.ai/blog/gemini-omni-1-1-flash-pricing), [aicybr guide](https://aicybr.com/blog/gemini-omni-1-1-flash-video-api-guide)
- [fal.ai pricing](https://fal.ai/pricing), [fal LatentSync](https://fal.ai/models/fal-ai/latentsync), [fal sync-lipsync v2](https://fal.ai/models/fal-ai/sync-lipsync/v2), [sync.so API](https://sync.so/api)
- [Teamday: video models by price/sec, Sep 2026](https://www.teamday.ai/blog/best-ai-video-models-2026), [Teamday: FAL vs Replicate](https://www.teamday.ai/blog/ai-image-video-api-providers-comparison-2026)
- Seedance 2.0: [fal Seedance 2.0](https://fal.ai/seedance-2.0), [fal reference-to-video](https://fal.ai/models/bytedance/seedance-2.0/fast/reference-to-video), [fal how-to](https://fal.ai/learn/tools/how-to-use-seedance-2-0), [tech report arXiv 2604.14148](https://arxiv.org/pdf/2604.14148), [audio guide (GitHub)](https://github.com/Emily2040/seedance-2.0/blob/main/references/audio-guide.md), [Cutout.pro audio guide](https://www.cutout.pro/learn/blog-seedance-2-0-audio-guide/)
- [ElevenLabs with-timestamps API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), [ElevenLabs price cut 2026-10-05](https://www.usagepricing.com/blueprint/activity/elevenlabs-2026-10-05-v4-launch-tts-price-cut)
- [Open-source TTS 2026 (ocdevel)](https://dev.ocdevel.com/blog/20250714-open-source-tts)
- [STT APIs 2026 benchmarks (futureagi)](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide), [Soniox STT pricing compare](https://soniox.com/compare/stt/pricing)
- [Arize: agent orchestration tools 2026](https://arize.com/resources/best-agent-orchestration-tools/), [LangGraph vs Temporal](https://gaas.it.com/langgraph-vs-temporal)
- [Holywater Tech (Wikipedia)](https://en.wikipedia.org/wiki/Holywater_Tech), [OutlierKit: AI tools for micro-drama 2026](https://outlierkit.com/resources/ai-tools-vertical-micro-drama-2026/)
- Claude prices: Anthropic models table as of 2026-10-06
- Replicate model pages (pricing tiers, 2026-10-22): [Seedance 2.0 Fast](https://replicate.com/bytedance/seedance-2.0-fast), [Seedance 2.0](https://replicate.com/bytedance/seedance-2.0), [Kling v3](https://replicate.com/kwaivgi/kling-v3-video), [Veo 3.1 Lite](https://replicate.com/google/veo-3.1-lite), [Veo 3.1 Fast](https://replicate.com/google/veo-3.1-fast), [ElevenLabs v3](https://replicate.com/elevenlabs/v3), [Scribe v2](https://replicate.com/elevenlabs/scribe-v2), [Claude Opus 5.5](https://replicate.com/anthropic/claude-opus-5.5)
- OpenRouter prices: `usage.cost` from our runs on 2026-10-21 (`runs/`, see `examples/README.md`)
