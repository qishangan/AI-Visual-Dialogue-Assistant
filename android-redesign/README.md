# AI Visual Dialogue Android

This is a native Android redesign of the current web project.

## Features

- Camera preview with optional drag selection for visual questions.
- Simple voice activity detection with `AudioRecord`.
- DashScope ASR using `qwen3-asr-flash`.
- DashScope visual transcription using `qwen-vl-plus`.
- DeepSeek streaming answer generation.
- DashScope TTS using `qwen3-tts-flash`.
- TTS toggle, replay for assistant audio, clear conversation, and status feedback.

## Setup

1. Open this folder in Android Studio:
   `D:\DeepSeek_Project\AI Visual Dialogue Assistant\android-redesign`
2. Edit `local.properties` and add:
   ```properties
   DASHSCOPE_API_KEY=sk-your-key-here
   DEEPSEEK_API_KEY=sk-your-key-here
   ```
3. Sync Gradle and run the `app` configuration on a device or emulator.

The app does not depend on the original Vite proxy; it calls DashScope and DeepSeek directly from Android.
