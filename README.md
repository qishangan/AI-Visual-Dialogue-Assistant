<p align="center">
  <img src="./项目图标（透明）.png" width="128" alt="AI Visual Dialogue Assistant Logo" />
</p>

<h1 align="center">AI Visual Dialogue Assistant</h1>

<p align="center">
  面向 K12 学习场景的 AI 视觉对话助手：看题、听题、引导学生自己想明白。
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=fff" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=fff" />
  <img alt="Android" src="https://img.shields.io/badge/Android-native-3DDC84?logo=android&logoColor=111" />
</p>

## Demo

[七上安刚刚发布的视频 https://b23.tv/h2JMfAr](https://b23.tv/h2JMfAr)

## Overview

AI Visual Dialogue Assistant 是一个企业命题实践项目，目标是开发一款能打开摄像头与麦克风、理解画面和语音并自然回复的 AI 对话应用。

项目当前聚焦“学习助手”场景：学生把题目放在摄像头前，用语音提问。应用会在语音开始时截取当前画面，支持用户框选题目区域，只把关键区域交给视觉模型，减少无关背景干扰和视觉 token 成本。AI 的回答不直接给最终答案，而是通过提问、提示和追问引导学生理解题目。

## Highlights

- **视觉 + 语音一体化交互**：摄像头实时预览、麦克风监听、ASR、视觉转写、流式回答和 TTS 播放串成完整链路。
- **题目区域框选**：支持鼠标/触摸拖拽框选题目或答题区域，避免上传整张画面。
- **视觉转写与回答解耦**：DashScope 负责图片客观转写，DeepSeek 结合语音文本、图片转写和上下文生成最终学习引导。
- **端侧 VAD**：在浏览器/Android 端判断语音开始和结束，减少静音上传和无效调用。
- **流式体验**：AI 回复实时显示，TTS 按句合成播放，降低等待感。
- **学习助手 Prompt**：默认不直接给答案，每轮只给一步提示，鼓励学生自己思考。
- **成本控制策略**：单帧截图、区域裁剪、图片压缩、历史摘要、音频缓存重播和 API Key 本地代理。
- **Web + Android 双端实现**：Web 端用于快速验证交互，Android 端提供原生移动端体验。

## Architecture

```text
Camera preview / region selection
        |
        v
Speech start detected by VAD -----> Capture selected image region
        |                                      |
        v                                      v
Speech end audio segment              DashScope image transcription
        |                                      |
        v                                      |
DashScope ASR -------------------------+
        |
        v
DeepSeek streaming learning response
        |
        v
Sentence-level DashScope TTS playback
```

## Tech Stack

| Area | Implementation |
| --- | --- |
| Web frontend | React 19, TypeScript, Vite |
| Web VAD | `@ricky0123/vad-web`, `onnxruntime-web` |
| Image processing | Canvas crop, JPEG compression, `browser-image-compression` |
| ASR | DashScope `qwen3-asr-flash` |
| Vision transcription | DashScope `qwen-vl-plus` |
| Dialogue generation | DeepSeek `deepseek-v4-flash` |
| TTS | DashScope `qwen3-tts-flash` |
| Android | Java, Camera/TextureView, AudioRecord, native UI |

## Quick Start

### Web

```bash
npm install
copy .env.example .env
npm run dev
```

Fill `.env`:

```env
DASHSCOPE_API_KEY=sk-your-key-here
DEEPSEEK_API_KEY=sk-your-key-here
```

Open the Vite local URL and allow camera/microphone permissions. The Web app uses the Vite proxy to call DashScope and DeepSeek, so API keys are not exposed to browser code. A production deployment should replace this with a real backend proxy.

### Android

Open [android-redesign](./android-redesign) in Android Studio, then configure `local.properties`:

```properties
DASHSCOPE_API_KEY=sk-your-key-here
DEEPSEEK_API_KEY=sk-your-key-here
```

Sync Gradle and run the `app` configuration on a device or emulator.

## Repository Structure

```text
.
├── src/                    # Web app source
│   ├── components/          # Camera, chat bubbles, status bar, toast
│   ├── hooks/               # Camera, VAD, ASR, dialogue, TTS, chat state
│   ├── services/            # ASR, vision, DeepSeek, TTS, image processing
│   └── utils/               # Constants, summary, audio, error handling
├── public/                  # VAD / ONNX runtime assets
├── android-redesign/        # Native Android implementation
├── DESIGN.md                # Design document required by the task
├── 项目图标（透明）.png
└── README.md
```

## Design Document

The design document covers:

- planned and completed user stories
- visual understanding and speech interaction design
- cloud/edge cost-control strategies
- known limitations and follow-up improvements

See [DESIGN.md](./DESIGN.md).

## Third-party Dependencies and Original Work

This project uses React, Vite, TypeScript, `@ricky0123/vad-web`, `onnxruntime-web`, `browser-image-compression`, Android Gradle Plugin, DashScope APIs and DeepSeek APIs.

Original implementation work includes:

- learning-assistant interaction flow and prompt design
- camera region selection UX
- Web `object-fit: cover` coordinate mapping for accurate crop
- speech-start snapshot timing
- image transcription + dialogue generation separation
- rule-based chat history compression
- streaming text-to-speech playback by sentence
- microphone pause/resume while AI audio is playing
- native Android Camera / AudioRecord / SelectionOverlay integration

## Submission Notes

This repository follows a PR-based delivery flow. Features are split into small branches and pull requests so reviewers can inspect the development process, implementation scope and validation method step by step.
