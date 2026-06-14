import { useCallback, useRef, useEffect, useState } from 'react';
import type { Message } from './types';
import { useCamera } from './hooks/useCamera';
import { useVAD } from './hooks/useVAD';
import { useASR } from './hooks/useASR';
import { useVLM } from './hooks/useVLM';
import { useChat } from './hooks/useChat';
import { compressImage, cropFromVideo, type CropRectCSS } from './services/imageProcessor';
import { classifyIntent } from './utils/intentClassifier';
import { CameraView, type SelectionRect } from './components/CameraView';
import { useTTS } from './hooks/useTTS';
import { ChatArea } from './components/ChatArea';
import { StatusBar } from './components/StatusBar';
import { ToastContainer, showToast } from './components/Toast';

export default function App() {
  const camera = useCamera();
  const chat = useChat();
  const asr = useASR();
  const vlm = useVLM();
  const tts = useTTS();

  // TTS 自动播放开关
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // TTS delta tracker: last length of streamingText already fed to TTS
  const ttsFedLenRef = useRef(0);

  // 暂存最新截图（在 onSpeechStart 时截取，onSpeechEnd 时使用）
  const snapshotRef = useRef<string | null>(null);
  // 暂存用户框选区域
  const selectionRef = useRef<SelectionRect | null>(null);
  // 暂存最后一次操作参数，用于 Toast 重试
  const lastAudioDataRef = useRef<Float32Array | null>(null);
  const lastVlmParamsRef = useRef<{
    userText: string;
    imageBase64?: string;
    history: Message[];
  } | null>(null);

  // --- 框选回调 ---
  const handleSelectionChange = useCallback((rect: SelectionRect | null) => {
    selectionRef.current = rect;
  }, []);

  // --- TTS: feed VLM streaming delta ---
  useEffect(() => {
    if (!ttsEnabled) return;
    const text = vlm.streamingText;
    if (text.length > ttsFedLenRef.current) {
      const delta = text.slice(ttsFedLenRef.current);
      ttsFedLenRef.current = text.length;
      tts.feed(delta);
    }
  }, [vlm.streamingText, tts, ttsEnabled]);

  // --- VAD callbacks ---
  const onSpeechStart = useCallback(async () => {
    // 停止上一轮 TTS 播放
    tts.stop();
    ttsFedLenRef.current = 0;

    chat.setStatus('listening');

    // 截图（VAD 检测到语音开始的同一帧）
    // 优先使用框选区域裁剪，否则发全图
    const video = camera.videoRef.current;
    const sel = selectionRef.current;
    if (sel && video && video.readyState >= 2) {
      try {
        const cssRect: CropRectCSS = {
          x: sel.x,
          y: sel.y,
          width: sel.width,
          height: sel.height,
        };
        snapshotRef.current = await cropFromVideo(video, cssRect);
        console.debug('[Snapshot] 框选裁剪成功, size:', snapshotRef.current.length);
      } catch {
        // 裁剪失败 → fallback 全图
        console.warn('[Snapshot] 框选裁剪失败，fallback 全图');
        const frame = await camera.captureFrame();
        if (frame) {
          try {
            snapshotRef.current = await compressImage(frame);
          } catch {
            snapshotRef.current = frame;
          }
        }
      }
    } else {
      const frame = await camera.captureFrame();
      if (frame) {
        try {
          const compressed = await compressImage(frame);
          snapshotRef.current = compressed;
          console.debug('[Snapshot] 全图截图成功, size:', compressed.length);
        } catch {
          // 压缩失败不影响文字对话
          snapshotRef.current = frame;
          console.debug('[Snapshot] 截图成功(未压缩), size:', frame.length);
        }
      } else {
        console.warn('[Snapshot] 截图失败 — video readyState:', video?.readyState);
      }
    }
  }, [camera, chat, tts]);

  const onSpeechEnd = useCallback(
    async (audioData: Float32Array) => {
      chat.setStatus('processing');

      // 1. ASR 识别
      lastAudioDataRef.current = audioData;
      const text = await asr.recognize(audioData);
      if (!text || text.trim().length === 0) {
        chat.setStatus('idle');
        return;
      }

      // 2. 意图分类
      const intent = classifyIntent(text);
      const imageToSend = intent.needsImage ? (snapshotRef.current ?? undefined) : undefined;

      // 3. 暂存历史（不含本轮消息，避免 VLM 请求中重复）
      const historyBefore = chat.messages;

      // 4. 添加用户消息到 UI
      chat.addUserMessage(text, imageToSend);

      // 5. 创建一条占位 assistant 消息（流式填充）
      chat.updateLastAssistantMessage('');

      // 6. 暂存 VLM 参数以备重试
      const vlmParams = {
        userText: text,
        imageBase64: imageToSend,
        history: historyBefore,
      };
      lastVlmParamsRef.current = vlmParams;

      // 7. 处理 VLM 流式响应
      chat.setStatus('speaking');
      ttsFedLenRef.current = 0;
      let fullResponse = '';
      try {
        fullResponse = await vlm.stream(vlmParams);

        // 确保最终文字完整写入
        if (fullResponse) {
          chat.updateLastAssistantMessage(fullResponse);
        }
        // 冲刷 TTS 缓冲区剩余文字，等待合成完成
        if (ttsEnabled) {
          await tts.flush();
          // 将合成音频缓存挂到消息上（用于重播）
          const audioChunks = tts.getAudio();
          if (audioChunks.length > 0) {
            chat.attachAudioToLastAssistant(audioChunks);
          }
        }
      } catch {
        // 流式中断：保留已收到的部分文字
        if (fullResponse) {
          chat.updateLastAssistantMessage(fullResponse);
        }
        if (ttsEnabled) {
          await tts.flush();
          const audioChunks = tts.getAudio();
          if (audioChunks.length > 0) {
            chat.attachAudioToLastAssistant(audioChunks);
          }
        }
        // 错误已由 useVLM 内部处理并设置 error 状态
      }

      chat.setStatus('idle');
      snapshotRef.current = null;
    },
    [asr, chat, vlm, tts, ttsEnabled]
  );

  const vad = useVAD({ onSpeechStart, onSpeechEnd });

  const handleClear = useCallback(() => {
    chat.clearMessages();
    tts.stop();
    ttsFedLenRef.current = 0;
  }, [chat, tts]);

  // --- 错误处理：监听 ASR / VLM 错误并弹出 Toast（含重试回调）---
  useEffect(() => {
    if (asr.error) {
      showToast(asr.error, 'error', () => {
        const audio = lastAudioDataRef.current;
        if (!audio) return;
        (async () => {
          chat.setStatus('processing');
          tts.stop();
          ttsFedLenRef.current = 0;
          const text = await asr.recognize(audio);
          if (!text || text.trim().length === 0) {
            chat.setStatus('idle');
            return;
          }
          const intent = classifyIntent(text);
          const img = intent.needsImage ? (snapshotRef.current ?? undefined) : undefined;
          const historyBefore = chat.messages;
          chat.addUserMessage(text, img);
          chat.updateLastAssistantMessage('');
          const vlmParams = { userText: text, imageBase64: img, history: historyBefore };
          lastVlmParamsRef.current = vlmParams;
          chat.setStatus('speaking');
          ttsFedLenRef.current = 0;
          let resp = '';
          try {
            resp = await vlm.stream(vlmParams);
            if (resp) chat.updateLastAssistantMessage(resp);
            if (ttsEnabled) {
              await tts.flush();
              const ac = tts.getAudio();
              if (ac.length > 0) chat.attachAudioToLastAssistant(ac);
            }
          } catch { /* VLM error shown by its own toast */ }
          chat.setStatus('idle');
        })();
      });
    }
  }, [asr.error, ttsEnabled]);

  useEffect(() => {
    if (vlm.error) {
      showToast(vlm.error, 'error', () => {
        const params = lastVlmParamsRef.current;
        if (!params) return;
        (async () => {
          chat.setStatus('speaking');
          tts.stop();
          ttsFedLenRef.current = 0;
          chat.updateLastAssistantMessage('');
          let resp = '';
          try {
            resp = await vlm.stream(params);
            if (resp) chat.updateLastAssistantMessage(resp);
            if (ttsEnabled) {
              await tts.flush();
              const ac = tts.getAudio();
              if (ac.length > 0) chat.attachAudioToLastAssistant(ac);
            }
          } catch { /* shown by its own toast */ }
          chat.setStatus('idle');
        })();
      });
    }
  }, [vlm.error, ttsEnabled]);

  // --- 网络状态监控 ---
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (isOffline) {
      showToast('网络连接中断，请检查网络后重试');
    }
  }, [isOffline]);

  return (
    <div style={styles.app}>
      {/* 上方 60% — 摄像头 */}
      <CameraView
        videoRef={camera.videoRef}
        status={chat.status}
        error={camera.error}
        onSelectionChange={handleSelectionChange}
      />

      {/* VAD 未初始化时的启动蒙层 */}
      {!vad.initialized && vad.status !== 'error' && !camera.error && (
        <div style={styles.startOverlay} onClick={() => vad.start()}>
          <div style={styles.startOverlayContent}>
            <span style={styles.startOverlayIcon}>🎤</span>
            <p style={styles.startOverlayText}>点击开始聆听</p>
            <p style={styles.startOverlayHint}>或点击底部按钮</p>
          </div>
        </div>
      )}

      {/* 中间 30% — 对话气泡 */}
      <ChatArea
        messages={chat.messages}
        streamingText={vlm.streamingText}
        isStreaming={vlm.isStreaming}
      />

      {/* 底部 10% — 状态栏 */}
      <StatusBar
        status={chat.status}
        vadStatus={vad.status}
        vadInitialized={vad.initialized}
        vadPaused={vad.paused}
        transcriptionPreview={asr.transcription}
        isTTSPlaying={tts.isPlaying}
        ttsEnabled={ttsEnabled}
        onToggleTTS={() => setTtsEnabled((v) => !v)}
        onClear={handleClear}
        onStartVAD={() => vad.start()}
        onPauseVAD={() => vad.pause()}
        onResumeVAD={() => vad.resume()}
      />

      {/* 全局 Toast */}
      <ToastContainer />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    maxWidth: 480,
    margin: '0 auto',
    backgroundColor: 'var(--color-bg)',
    boxShadow: 'var(--shadow)',
  },
  startOverlay: {
    flex: '6 0 0',
    position: 'absolute',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10,
    cursor: 'pointer',
  },
  startOverlayContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  startOverlayIcon: {
    fontSize: 56,
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  startOverlayText: {
    fontSize: 20,
    fontWeight: 600,
    color: '#fff',
  },
  startOverlayHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
};
