import { useRef, useEffect } from 'react';
import type { Message } from '../types';
import { ChatBubble } from './ChatBubble';

interface ChatAreaProps {
  messages: Message[];
  streamingText?: string;
  isStreaming?: boolean;
}

/**
 * 对话气泡区域（占中间 30%）。
 * 自动滚动到底部；AI 回复中显示三点加载动画（未收到首 token 时）。
 */
export function ChatArea({ messages, streamingText, isStreaming }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // 是否正在等待 AI 首 token
  const awaitingResponse =
    isStreaming &&
    (!streamingText || streamingText.length === 0) &&
    messages.length > 0 &&
    messages[messages.length - 1].role !== 'assistant';

  return (
    <div style={styles.container}>
      <div style={styles.scrollArea}>
        {messages.length === 0 && !isStreaming && (
          <div style={styles.placeholder}>
            <p style={styles.placeholderText}>
              📷 打开摄像头，直接开口提问
            </p>
            <p style={styles.placeholderHint}>
              试试说「这道题我不会」
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {/* 流式输出的当前 assistant 消息 */}
        {isStreaming && streamingText && (
          <ChatBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              text: streamingText,
              timestamp: Date.now(),
            }}
            isStreaming={isStreaming}
          />
        )}

        {/* 等待 AI 首 token：三点加载动画 */}
        {awaitingResponse && (
          <div style={styles.loadingWrapper}>
            <div style={styles.loadingBubble}>
              <span style={styles.dot}>●</span>
              <span style={{ ...styles.dot, animationDelay: '0.2s' }}>●</span>
              <span style={{ ...styles.dot, animationDelay: '0.4s' }}>●</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: '3 0 0',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-bg-secondary)',
    minHeight: 0,
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: 'var(--color-text-secondary)',
    marginBottom: 8,
  },
  placeholderHint: {
    fontSize: 13,
    color: 'var(--color-text-secondary)',
    opacity: 0.6,
  },
  loadingWrapper: {
    display: 'flex',
    justifyContent: 'flex-start',
    padding: '4px 12px',
  },
  loadingBubble: {
    backgroundColor: 'var(--color-bubble-assistant)',
    padding: '10px 14px',
    borderRadius: 'var(--radius)',
    display: 'flex',
    gap: 6,
  },
  dot: {
    fontSize: 10,
    color: 'var(--color-text-secondary)',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
};
