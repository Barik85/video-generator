# Research: сирі факти для вибору стеку

> Зібрано 2026-10-20. Це **лише факти й ціни** — без висновків і рекомендацій.
> Порівняння та фінальне обґрунтування для Частини 1 пишеться вручну (умова завдання).
> Ціни змінюються часто; агрегатори між собою розходяться. Перед бюджетуванням звіряти з живими сторінками.

## 1. Відео-генерація

| Модель | Де | Ціна | Аудіо | Тривалість / формат | Примітки |
|---|---|---|---|---|---|
| Veo 3.1 Standard | Gemini API | $0.40/с (720p/1080p), $0.60/с (4K) | нативне | 4–8 с | **Preview-ID deprecated, shutdown 2026-10-22** (офіційна сторінка pricing) |
| Veo 3.1 Fast | Gemini API | $0.10 / $0.12 / $0.30 за с (720p/1080p/4K) | нативне | — | те саме — shutdown 2026-10-22 |
| Veo 3.1 Lite | Gemini API | $0.05 / $0.08 за с | нативне | — | те саме — shutdown 2026-10-22 |
| Veo 3.1 (`veo-3.1-generate-001`) | Vertex AI | — | нативне | — | GA, за неперевіреними даними retirement «не раніше 2026-11-17» |
| Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`) | Gemini API | ~$0.10/с 720p (офіційно); інші роздільності — лише оцінки реселерів | нативне, діалоги | до 10 с за генерацію, scene extension до 40 с | Google називає заміною Veo 3.1 preview. Free tier немає |
| Kling v3 Pro (`fal-ai/kling-video/v3/pro/image-to-video`) | fal.ai | $0.14/с | є варіант з аудіо | 5/10 с, 9:16 | на сторонніх сайтах трапляються інші ціни для v3 ($0.112–0.28/с) |
| Kling v3 Standard | fal.ai | $0.14/с (≈$0.63 за кліп) | — | — | |
| Kling v2.5 turbo pro | fal.ai | $0.07/с | ні | 5/10 с | |
| Kling O3 Pro / Standard | fal.ai | $0.14/с | — | — | |
| Seedance 2.0 Fast / Mini | fal.ai | токени: ≈$1.21 / ≈$0.76 за 5 с | — | reference-to-video | |
| MiniMax H3 Max / Max Turbo | fal.ai | $0.05/с / $0.025/с | — | reference / image-to-video | |
| Grok Imagine Video | fal.ai | $0.05/с | — | — | |
| PixVerse V6 | fal.ai | $0.005/с (≈$0.225 за 5 с) | — | — | |
| Wan 2.5 / 3.0 | fal / Alibaba | $0.05/с (480p) … $0.15–0.20/с (1080p) | — | — | open weights, можна self-host |
| Sora 2 Pro | fal.ai | $0.30/с (720p) – $0.50/с (1080p) | нативне | — | |

### Seedance 2.0 (ByteDance) — детальніше

| Параметр | Значення (fal.ai, `bytedance/seedance-2.0/...`) |
|---|---|
| Ендпоінти | text-to-video, image-to-video, reference-to-video; тири Standard / Fast / Mini |
| Reference inputs | до 9 зображень + 3 відео (сумарно 2–15 с) + 3 аудіо (сумарно ≤15 с), разом ≤12 файлів. В промпті посилання `@Image1`, `@Video1`, `@Audio1`. Аудіо вимагає хоча б одного зображення чи відео |
| Тривалість | `auto` або 4–15 с за генерацію |
| Формат | 9:16 підтримується; 480p або 720p (1080p — лише Standard, ~$0.68/с) |
| Аудіо | `generate_audio=true` за замовчуванням: діалог, SFX, ambient, lip-sync. **Аудіо не коштує додатково** |
| Ціна | Standard ~$0.30/с; Fast $0.2419/с (720p); з відео-референсом ×0.6 (~$0.145/с). Токени: `h×w×(in_dur+out_dur)×24/1024`, $0.011–0.014 за 1K |
| Чи керує завантажене аудіо губами | Офіційна сторінка fal **не документує**. Community-гайди радять промпт «use @Audio1 as her dialogue voice, sync lip movement», але попереджають: «do not promise exact playback», результат імовірнісний, потрібні ретейки |
| Якість синхрону (тех. репорт ByteDance) | English AV-sync 4.17/5; multi-person Chinese dialogue 3.86/5 (власний бенчмарк) |
| Мови | Mandarin найкраще, English близько; інші мови слабші, інколи з англ. акцентом (польові звіти) |
| Практичні поради з гайдів | locked medium close-up, без поворотів голови під час репліки, прибрати музику/SFX з промпту, коли важливий діалог |

Відомі ризики з оглядів: на складних промптах «voice scrambling» і зіпсований текст у кадрі.

**Спостереження без оцінки:** моделі з нативним аудіо генерують мовлення самі, і **немає гарантії дослівності репліки**. Моделі без аудіо потребують окремого TTS + накладання / lip-sync.

## 2. TTS (озвучка)

| Модель | Де | Ціна | Таймінги | Примітки |
|---|---|---|---|---|
| ElevenLabs v3 / v4 / Multilingual v2 | ElevenLabs API | $0.08 за 1K символів (v3, v2, v4); Flash/Turbo $0.04 (після зниження цін 2026-10-05) | endpoint `/with-timestamps` повертає **посимвольний** alignment (`characters`, `character_start_times_seconds`, `character_end_times_seconds`) | `seed` є, але детермінізм не гарантований. WAV 44.1 kHz — лише з тарифу Pro |
| MiniMax Speech 2.8 HD / Turbo | fal.ai | $0.10 / $0.06 за 1K символів | — | |
| Gemini 3.1 Flash TTS | fal.ai | $0.05 за 1K символів | — | |
| Inworld TTS-1.5 Max | fal.ai | $0.01 за 1K символів | — | |
| xAI TTS | fal.ai | $0.015 за 1K символів | — | |
| Chatterbox | fal.ai / open source (MIT) | $0.025 за 1K символів | — | voice cloning з 7–10 с аудіо |
| Kokoro | fal.ai / open source (Apache 2.0, 82M) | $0.02 за 1K символів | — | працює на CPU, 54 голоси, без клонування |

Для TTS текст подається на вхід напряму, тож дослівність визначається самим текстом. Ризик полягає в нормалізації (числа, абревіатури) і пропуску чи «ковтанні» слів.

## 3. Lip-sync (накласти задане аудіо на згенероване відео)

| Модель | Де | Ціна |
|---|---|---|
| LatentSync (ByteDance) | fal.ai | $0.20 за відео ≤40 с, далі $0.005/с |
| sync lipsync 1.9 | fal.ai | $0.70/хв |
| sync lipsync 2.0 / 2.0 Pro | fal.ai | $3/хв / $5/хв |
| sync.so (lipsync-1.9 … sync-3) | власне API | $0.02/с … $0.133/с |

## 4. ASR (автоматична перевірка «чи прозвучала репліка дослівно»)

| Модель | Ціна | Word timestamps | WER (з різних джерел, не порівнювано між собою) |
|---|---|---|---|
| ElevenLabs Scribe v2 | ~$0.22–0.27/год (batch) | так, + diarization, keyterm prompting | FLEURS 93.5% accuracy (realtime) |
| Deepgram Nova-3 | від $0.0043/хв (batch, англ.) | так | 5.26% (vendor benchmark) |
| OpenAI gpt-4o-transcribe / mini | $0.36 / $0.18 за год | word-level лише для `whisper-1` | ~8.9% (Artificial Analysis) |
| Whisper large-v3 | безкоштовно (self-host, CPU/GPU) | так (через faster-whisper / whisperx) | — |

## 5. LLM (ідея → сценарій → shot-list, структурований вихід)

| Модель | Input $/1M | Output $/1M | Примітки |
|---|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | structured outputs (`output_config.format`, `messages.parse`), 1M контекст |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | те саме |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 | ≤100K токенів промпту |
| Gemini 3.1 Pro Preview | $2 | $12 | |
| Gemini 3.8 Flash | $0.75 | $3.75 | ціни зростають удвічі з 2027-01-01 |

Сценарій на 8–30 с займає кілька сотень токенів, тож вартість LLM-кроку на ролик мізерна порівняно з відео.

## 6. Оркестрація / стан

| Інструмент | Тип | Що відомо |
|---|---|---|
| LangGraph (1.2.x) | граф агентів | чекпоінти, pause/resume для human approval; бібліотека безкоштовна, LangSmith платний |
| Temporal | durable execution | переживає падіння воркерів, мультимовний, довгі (дні) workflow; окремий сервер |
| Inngest | durable steps, event-driven | managed інфраструктура, сильний у TS/JS |
| Prefect | workflow engine | додав AI-agent примітиви; детальних порівнянь не знайдено |
| Власний step-runner + файловий/SQLite стан | — | без залежностей; durability = ідемпотентні кроки + артефакти на диску |

Класифікація, що трапляється в оглядах: graph-based (LangGraph), role-based (CrewAI, OpenAI Agents SDK), durable-execution (Temporal, Inngest).

## 7. Контекст домену

- Holywater Tech (My Drama) у лютому 2026 купили AI-VFX студію Jeynix і ребрендувались під AI-first. Fox Entertainment робить понад 200 вертикальних тайтлів для My Drama.
- Огляди мікро-драм 2026 року: жоден інструмент не закриває одночасно консистентність персонажа, монтажну безперервність і синхрон діалогу. Тому інструменти ланцюжать. Консистентність досягається через **reference images**, а не через окремий промпт для кожного шоту.

## 8. Ризики, які видно з фактів (без зважування)

- Veo 3.1 preview-ID вимикаються 2026-10-22, тобто ціни й ID відео-моделей живуть місяцями.
- Ціни на ту саму модель розходяться між агрегаторами в 2 рази.
- Нативне аудіо у відео-моделях не гарантує дослівності.
- Детермінізм TTS не гарантований навіть із `seed`.

## Джерела

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
- Ціни Claude: таблиця моделей Anthropic станом на 2026-10-06
