import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message } from '../types';
import { playAudioChunks } from '../utils/audioPlayer';

interface ChatBubbleProps {
  message: Message;
  /** 流式输出时，此气泡的文字正在被追加 */
  isStreaming?: boolean;
}

/**
 * 单条对话气泡。
 * user 靠右蓝色，assistant 靠左灰色。
 * assistant 消息若有 TTS 音频缓存，显示重播按钮。
 */
export function ChatBubble({ message, isStreaming }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const hasAudio = !isUser && message.audioChunks && message.audioChunks.length > 0;

  // 音频播放状态
  const [audioPlaying, setAudioPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const handleToggleAudio = useCallback(() => {
    if (audioPlaying) {
      // 停止播放
      stopRef.current?.();
      stopRef.current = null;
      setAudioPlaying(false);
    } else {
      // 开始播放
      if (!message.audioChunks || message.audioChunks.length === 0) return;
      const { promise, stop } = playAudioChunks(message.audioChunks);
      stopRef.current = stop;
      setAudioPlaying(true);
      promise.finally(() => {
        stopRef.current = null;
        setAudioPlaying(false);
      });
    }
  }, [audioPlaying, message.audioChunks]);

  // 组件卸载时停止音频播放
  useEffect(() => {
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        ...styles.wrapper,
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          ...styles.bubble,
          backgroundColor: isUser
            ? 'var(--color-bubble-user)'
            : 'var(--color-bubble-assistant)',
          alignSelf: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        <p style={styles.text}>
          {message.text}
          {isStreaming && <span style={styles.cursor}>▍</span>}
        </p>

        {/* 语音重播按钮（仅 AI 消息，有音频缓存时显示） */}
        {hasAudio && (
          <button
            style={{
              ...styles.audioBtn,
              color: audioPlaying ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
            onClick={handleToggleAudio}
            title={audioPlaying ? '停止播放' : '播放语音'}
            aria-label={audioPlaying ? '停止播放' : '播放语音'}
          >
            {audioPlaying ? '⏹' : '🔊'}
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    padding: '4px 12px',
  },
  bubble: {
    maxWidth: '80%',
    padding: '10px 14px',
    borderRadius: 'var(--radius)',
    lineHeight: 1.6,
    position: 'relative',
  },
  text: {
    fontSize: 15,
    color: 'var(--color-text)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
  },
  cursor: {
    animation: 'blink 0.8s step-end infinite',
    color: 'var(--color-accent)',
  },
  audioBtn: {
    display: 'inline-block',
    marginTop: 6,
    padding: '2px 6px',
    fontSize: 14,
    lineHeight: 1,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    opacity: 0.7,
    transition: 'opacity 0.15s',
  },
};
