import { useCallback, useRef, useEffect, useState } from 'react';
import type { Message } from './types';
import { useCamera } from './hooks/useCamera';
import { useVAD } from './hooks/useVAD';
import { useASR } from './hooks/useASR';
import { useDialogue } from './hooks/useDialogue';
import { useChat } from './hooks/useChat';
import { compressImage, cropFromVideo, type CropRectCSS } from './services/imageProcessor';
import { describeImage } from './services/vlm';
import { CameraView, type SelectionRect } from './components/CameraView';
import { useTTS } from './hooks/useTTS';
import { ChatArea } from './components/ChatArea';
import { StatusBar } from './components/StatusBar';
import { ToastContainer, showToast } from './components/Toast';

interface AssistantParams {
  userText: string;
  imageDescription?: string;
  history: Message[];
}

export default function App() {
  const camera = useCamera();
  const chat = useChat();
  const asr = useASR();
  const dialogue = useDialogue();
  const tts = useTTS();

  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const ttsFedLenRef = useRef(0);
  const snapshotRef = useRef<string | null>(null);
  const imageDescriptionRef = useRef<Promise<string> | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);
  const lastAudioDataRef = useRef<Float32Array | null>(null);
  const lastAssistantParamsRef = useRef<AssistantParams | null>(null);
  const vadAutoPausedByTtsRef = useRef(false);

  const handleSelectionChange = useCallback((rect: SelectionRect | null) => {
    selectionRef.current = rect;
  }, []);

  const captureCurrentFrame = useCallback(async (): Promise<string | null> => {
    const video = camera.videoRef.current;
    const selection = selectionRef.current;

    if (selection && video && video.readyState >= 2) {
      try {
        const cssRect: CropRectCSS = {
          x: selection.x,
          y: selection.y,
          width: selection.width,
          height: selection.height,
        };
        const cropped = await cropFromVideo(video, cssRect);
        console.debug('[Snapshot] 框选裁剪成功, size:', cropped.length);
        return cropped;
      } catch (error) {
        console.warn('[Snapshot] 框选裁剪失败，fallback 全图', error);
      }
    }

    const frame = await camera.captureFrame();
    if (!frame) {
      console.warn('[Snapshot] 截图失败 — video readyState:', video?.readyState);
      return null;
    }

    try {
      const compressed = await compressImage(frame);
      console.debug('[Snapshot] 全图截图成功, size:', compressed.length);
      return compressed;
    } catch (error) {
      console.warn('[Snapshot] 图片压缩失败，使用原图', error);
      return frame;
    }
  }, [camera]);

  const startImageDescription = useCallback((imageBase64: string | null) => {
    if (!imageBase64) {
      imageDescriptionRef.current = null;
      return;
    }

    imageDescriptionRef.current = describeImage(imageBase64).catch((error) => {
      console.warn('[Vision] 图片转写失败，降级为纯文字回答', error);
      return '';
    });
  }, []);

  const flushTtsToLastAssistant = useCallback(async () => {
    if (!ttsEnabled) return;

    await tts.flush();
    const audioChunks = tts.getAudio();
    if (audioChunks.length > 0) {
      chat.attachAudioToLastAssistant(audioChunks);
    }
  }, [chat, tts, ttsEnabled]);

  const runAssistantReply = useCallback(
    async (params: AssistantParams) => {
      lastAssistantParamsRef.current = params;
      chat.setStatus('speaking');
      ttsFedLenRef.current = 0;

      let fullResponse = '';
      try {
        fullResponse = await dialogue.stream(params);
      } finally {
        if (fullResponse) {
          chat.updateLastAssistantMessage(fullResponse);
        }
        await flushTtsToLastAssistant();
      }

      return fullResponse;
    },
    [chat, dialogue, flushTtsToLastAssistant]
  );

  useEffect(() => {
    if (!ttsEnabled) return;
    const text = dialogue.streamingText;
    if (text.length > ttsFedLenRef.current) {
      const delta = text.slice(ttsFedLenRef.current);
      ttsFedLenRef.current = text.length;
      tts.feed(delta);
    }
  }, [dialogue.streamingText, tts, ttsEnabled]);

  const onSpeechStart = useCallback(async () => {
    tts.stop();
    ttsFedLenRef.current = 0;
    chat.setStatus('listening');

    const snapshot = await captureCurrentFrame();
    snapshotRef.current = snapshot;
    startImageDescription(snapshot);
  }, [captureCurrentFrame, chat, startImageDescription, tts]);

  const onSpeechEnd = useCallback(
    async (audioData: Float32Array) => {
      chat.setStatus('processing');
      lastAudioDataRef.current = audioData;

      const text = await asr.recognize(audioData);
      if (!text || text.trim().length === 0) {
        chat.setStatus('idle');
        return;
      }

      const imageDescription = (await imageDescriptionRef.current) || undefined;
      const imageToDisplay = snapshotRef.current ?? undefined;
      const historyBefore = chat.messages;

      chat.addUserMessage(text, imageToDisplay, imageDescription);
      chat.updateLastAssistantMessage('');

      try {
        await runAssistantReply({
          userText: text,
          imageDescription,
          history: historyBefore,
        });
      } catch {
        // useDialogue 会设置错误状态，Toast 监听负责展示与重试。
      } finally {
        chat.setStatus('idle');
        snapshotRef.current = null;
        imageDescriptionRef.current = null;
      }
    },
    [asr, chat, runAssistantReply]
  );

  const vad = useVAD({ onSpeechStart, onSpeechEnd });
  const {
    initialized: vadInitialized,
    paused: vadPaused,
    pause: pauseVad,
    resume: resumeVad,
  } = vad;

  const handleClear = useCallback(() => {
    chat.clearMessages();
    tts.stop();
    dialogue.cancel();
    ttsFedLenRef.current = 0;
    snapshotRef.current = null;
    imageDescriptionRef.current = null;
  }, [chat, dialogue, tts]);

  useEffect(() => {
    if (!vadInitialized) return;

    if (!ttsEnabled) {
      if (vadAutoPausedByTtsRef.current) {
        vadAutoPausedByTtsRef.current = false;
        void resumeVad();
      }
      return;
    }

    if (tts.isPlaying && !vadPaused) {
      vadAutoPausedByTtsRef.current = true;
      void pauseVad();
      return;
    }

    if (!tts.isPlaying && vadAutoPausedByTtsRef.current) {
      vadAutoPausedByTtsRef.current = false;
      void resumeVad();
    }
  }, [tts.isPlaying, ttsEnabled, vadInitialized, vadPaused, pauseVad, resumeVad]);

  useEffect(() => {
    if (!asr.error) return;

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

        const imageDescription = (await imageDescriptionRef.current) || undefined;
        const historyBefore = chat.messages;
        chat.addUserMessage(text, snapshotRef.current ?? undefined, imageDescription);
        chat.updateLastAssistantMessage('');

        try {
          await runAssistantReply({ userText: text, imageDescription, history: historyBefore });
        } catch {
          // 对话错误由下一段 effect 展示。
        } finally {
          chat.setStatus('idle');
        }
      })();
    });
  }, [asr.error, asr, chat, runAssistantReply, tts]);

  useEffect(() => {
    if (!dialogue.error) return;

    showToast(dialogue.error, 'error', () => {
      const params = lastAssistantParamsRef.current;
      if (!params) return;

      (async () => {
        tts.stop();
        ttsFedLenRef.current = 0;
        chat.updateLastAssistantMessage('');
        try {
          await runAssistantReply(params);
        } catch {
          // 错误状态会继续由 useDialogue 暴露。
        } finally {
          chat.setStatus('idle');
        }
      })();
    });
  }, [dialogue.error, chat, runAssistantReply, tts]);

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
      <CameraView
        videoRef={camera.videoRef}
        status={chat.status}
        error={camera.error}
        onSelectionChange={handleSelectionChange}
      />

      {!vad.initialized && vad.status !== 'error' && !camera.error && (
        <div style={styles.startOverlay} onClick={() => vad.start()}>
          <div style={styles.startOverlayContent}>
            <span style={styles.startOverlayIcon}>🎤</span>
            <p style={styles.startOverlayText}>点击开始聆听</p>
            <p style={styles.startOverlayHint}>或点击底部按钮</p>
          </div>
        </div>
      )}

      <ChatArea
        messages={chat.messages}
        streamingText={dialogue.streamingText}
        isStreaming={dialogue.isStreaming}
      />

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
