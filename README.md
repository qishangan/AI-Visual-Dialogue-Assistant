# AI Visual Dialogue Assistant

<p align="center">
  <img src="./项目图标.png" width="128" alt="AI Visual Dialogue Assistant 项目图标" />
</p>

一款面向学习场景的 AI 视觉对话助手。应用会打开摄像头和麦克风，在用户说话时自动截取当前画面，结合语音识别、视觉理解、流式对话和语音播报，像学习伙伴一样引导学生理解题目。

项目重点不是把整张视频画面持续上传给模型，而是让用户先框选题目或答题区域，再只上传关键区域截图。这样能减少无关背景干扰，也能降低视觉 token 与接口调用成本。

## 演示

[![演示视频封面](./项目图标.png)](./演示视频.mp4)

点击上方图片或打开 [演示视频.mp4](./演示视频.mp4) 查看完整 demo。

## 核心功能

- 摄像头实时预览，支持鼠标或触摸拖拽框选题目区域。
- 麦克风语音交互，使用端侧 VAD 自动判断说话开始和结束。
- ASR 将用户语音转成文本，再由视觉/语言模型结合截图理解题目。
- AI 回复采用流式输出，TTS 按句合成并自动播放，减少等待感。
- 学习助手式 System Prompt：优先提问和提示，不直接给最终答案。
- 对话历史自动压缩，保留上下文的同时控制提示词长度。
- AI 语音支持开关和重播，支持清空对话和状态提示。
- 仓库包含 Web 版本和原生 Android 重设计版本。

## 技术栈

- Web：React 19、TypeScript、Vite。
- 端侧语音检测：`@ricky0123/vad-web`、`onnxruntime-web`。
- 图像处理：Canvas 裁剪、JPEG 压缩、`browser-image-compression`。
- 云端模型：DashScope `qwen3-asr-flash`、`qwen-vl-plus`、`qwen3-tts-flash`。
- Android：Java、Camera/TextureView、AudioRecord VAD、DashScope、DeepSeek。

## 第三方依赖与原创实现说明

本项目使用了 React、Vite、TypeScript、`@ricky0123/vad-web`、`onnxruntime-web`、`browser-image-compression` 和 Android Gradle Plugin 等第三方库或框架。云端模型能力来自 DashScope 与 DeepSeek API。

原创实现部分主要包括：学习助手式对话流程设计、摄像头区域框选交互、Web 端 `object-fit: cover` 坐标映射裁剪、按语音起点截取画面、关键词式视觉意图判断、对话历史规则压缩、流式回复驱动的分句 TTS 播放、AI 朗读期间暂停麦克风监听，以及原生 Android 版本的 Camera/AudioRecord/SelectionOverlay 集成。

## 快速运行 Web 版本

```bash
npm install
copy .env.example .env
npm run dev
```

然后在 `.env` 中填入：

```env
DASHSCOPE_API_KEY=sk-your-key-here
```

浏览器打开 Vite 输出的本地地址，并允许摄像头与麦克风权限。Web 版本通过 Vite 本地代理调用 DashScope，API Key 不会暴露给浏览器前端代码；如果要部署到公网，需要额外准备后端代理。

## 运行 Android 版本

Android 版本位于 [android-redesign](./android-redesign)。用 Android Studio 打开该目录，在 `local.properties` 中配置：

```properties
DASHSCOPE_API_KEY=sk-your-key-here
DEEPSEEK_API_KEY=sk-your-key-here
```

同步 Gradle 后运行 `app` 配置即可。

## 项目结构

```text
.
├── src/                    # Web 应用源码
│   ├── components/          # 摄像头、对话气泡、状态栏等 UI
│   ├── hooks/               # Camera、VAD、ASR、VLM、TTS、Chat 状态
│   ├── services/            # ASR/VLM/TTS 请求与图片处理
│   └── utils/               # 意图分类、摘要压缩、错误处理
├── public/                  # VAD/ONNX 运行时资源
├── android-redesign/        # 原生 Android 版本
├── DESIGN.md                # 设计文档
├── 项目图标.png
└── 演示视频.mp4
```

## 设计文档

完整设计说明、用户故事完成情况和运营成本控制策略见 [DESIGN.md](./DESIGN.md)。
