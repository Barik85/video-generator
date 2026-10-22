# Example videos

Each file is named `<video model>_<audio mode>_<scene>.mp4`. All of them went through OpenRouter, generated on 2026-10-21. Every run used:
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

Ideas:
- **gas-station:** A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: "You know what is inside. Do not open it until morning."
- **rooftop:** A rooftop at dawn over a sleeping city. A young man in a grey hoodie tells his sister: "I sold the car. We leave tonight." She smiles and answers: "Then I am driving."

Each run's full state (script, keyframes, every take, ASR transcripts, costs) stays in `runs/<run>/`. That folder is gitignored.
