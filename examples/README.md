# Example videos

Each file is named `<video model>_<audio mode>_<scene>.mp4`. All of them went through OpenRouter, generated on 2026-10-21 and 2026-10-22. Every run used:
- Claude Opus 5.5 for the script
- Seedream 5.0 Flash for the keyframes
- ElevenLabs Scribe v2 for the verbatim check
- 720×1280 output

| File | Video model | Audio | Length | Takes on the dialogue shot | WER | Cost | Run |
|---|---|---|---|---|---|---|---|
| `seedance-2.0-fast_native-audio_gas-station.mp4` | Seedance 2.0 Fast | spoken by the video model | 13 s | 1 | 0 | $1.27 | `run_20261021160650_36ba` |
| `seedance-2.0-fast_lipsync-elevenlabs-v3_gas-station.mp4` | Seedance 2.0 Fast | ElevenLabs v3 TTS, lip-synced via `@Audio1` | 14 s | 1 | 0 | $1.36 | `run_20261021164857_457b` |
| `kling-v3-std_native-audio_gas-station.mp4` | Kling v3 Standard | spoken by the video model | 12 s | 1 | 0 | $2.10 | `run_20261021161802_517b` |
| `seedance-2.0-fast_native-audio_rooftop.mp4` | Seedance 2.0 Fast | spoken by the video model, two speakers | 15 s | 1 + 1 | 0 | $1.45 | `run_20261021162650_dcd8` |
| `seedance-2.0-fast_native-audio_wedding-child.mp4` | Seedance 2.0 Fast | spoken by the video model, a child speaker | 15 s | 1 | 0 | $1.46 | `run_20261022120735_cfc7` |

Ideas:
- **gas-station:** A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: "You know what is inside. Do not open it until morning."
- **wedding-child:** A sunny wedding reception on a rooftop. Just as the bride lifts her glass for a toast, a little boy tugs her dress, points at the groom, and loudly says: "That's the man who was crying at my mom's grave yesterday." Started from the web UI with a script review.
- **rooftop:** A rooftop at dawn over a sleeping city. A young man in a grey hoodie tells his sister: "I sold the car. We leave tonight." She smiles and answers: "Then I am driving."

**Why wedding-child is native.** The same idea was first started with `or-seedance-lipsync` (`run_20261022115820_a179`). The script's voice field allows only `female` or `male`, so the six-year-old got the adult male TTS voice (median pitch ~118 Hz), and in lipsync mode that track would have been the final soundtrack. The reviewer caught it at the keyframes checkpoint, before any video was paid for ($0.08 spent). In native mode the video model voiced the boy itself: median pitch ~242 Hz, WER 0. A `child` voice option in the script schema would fix lipsync mode; not done.

Each run's full state (script, keyframes, every take, ASR transcripts, costs) stays in `runs/<run>/`. That folder is gitignored.
