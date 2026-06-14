import { useState, useCallback } from 'react';
import type { Message, AppStatus } from '../types';
import { MAX_CHAT_ROUNDS } from '../utils/constants';
import { compressHistory } from '../utils/summarizer';

let nextId = 1;

interface UseChatResult {
  messages: Message[];
  status: AppStatus;
  setStatus: (s: AppStatus) => void;
  addUserMessage: (text: string, imageBase64?: string, visualDescription?: string) => Message;
  updateLastAssistantMessage: (text: string) => void;
  /** 将音频缓存挂到最近一条 assistant 消息上 */
  attachAudioToLastAssistant: (chunks: ArrayBuffer[]) => void;
  clearMessages: () => void;
}

/**
 * 对话状态管理。
 * 超过 MAX_CHAT_ROUNDS 轮时自动将旧消息压缩为规则摘要，
 * 而非简单截断，保留对话上下文。
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AppStatus>('idle');

  const addUserMessage = useCallback(
    (text: string, imageBase64?: string, visualDescription?: string): Message => {
      const msg: Message = {
        id: `msg-${nextId++}`,
        role: 'user',
        text,
        imageBase64,
        visualDescription,
        timestamp: Date.now(),
      };

      setMessages((prev) => {
        const updated = [...prev, msg];

        // 超过 MAX_CHAT_ROUNDS 轮 → 摘要压缩
        const maxMessages = MAX_CHAT_ROUNDS * 2;
        if (updated.length > maxMessages) {
          return compressHistory(updated, MAX_CHAT_ROUNDS);
        }

        return updated;
      });

      return msg;
    },
    []
  );

  const updateLastAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant') {
        // 流式更新：替换最后一条 assistant 消息的 text
        return [
          ...prev.slice(0, -1),
          { ...last, text },
        ];
      }
      // 不存在 assistant 消息 → 新建
      const msg: Message = {
        id: `msg-${nextId++}`,
        role: 'assistant',
        text,
        timestamp: Date.now(),
      };
      return [...prev, msg];
    });
  }, []);

  const attachAudioToLastAssistant = useCallback((chunks: ArrayBuffer[]) => {
    setMessages((prev) => {
      // 从后往前找最近一条 assistant 消息
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'assistant') {
          const updated = [...prev];
          updated[i] = { ...updated[i], audioChunks: chunks };
          return updated;
        }
      }
      return prev;
    });
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStatus('idle');
  }, []);

  return {
    messages,
    status,
    setStatus,
    addUserMessage,
    updateLastAssistantMessage,
    attachAudioToLastAssistant,
    clearMessages,
  };
}
