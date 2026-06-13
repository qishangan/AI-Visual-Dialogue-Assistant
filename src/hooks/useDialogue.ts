import { useState, useCallback, useRef } from 'react';
import { streamAnswer } from '../services/deepseek';
import { classifyError } from '../utils/errorTypes';
import type { Message } from '../types';

interface UseDialogueResult {
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  /** 发起学习助手流式回答，返回完整文字 */
  stream: (params: {
    userText: string;
    imageDescription?: string;
    history: Message[];
  }) => Promise<string>;
  cancel: () => void;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1500;

/**
 * 管理最终学习助手回答流。
 * 图片在进入本 Hook 前已经由视觉模型转写成文字，最终回答由 DeepSeek 结合
 * 用户语音、视觉转写和历史上下文生成。
 * 逐 chunk 追加 streamingText，返回最终完整文字。
 * 对 retryable 错误（限流、服务端错误）自动指数退避重试。
 */
export function useDialogue(): UseDialogueResult {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const stream = useCallback(
    async ({
      userText,
      imageDescription,
      history,
    }: {
      userText: string;
      imageDescription?: string;
      history: Message[];
    }): Promise<string> => {
      setIsStreaming(true);
      setStreamingText('');
      setError(null);

      let fullText = '';
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          for await (const chunk of streamAnswer(
            history,
            userText,
            imageDescription,
            controller.signal
          )) {
            fullText += chunk;
            setStreamingText((prev) => prev + chunk);
          }

          // 成功 → 清理流式状态再返回
          setIsStreaming(false);
          setStreamingText('');
          return fullText;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setIsStreaming(false);
            setStreamingText('');
            return fullText;
          }

          const appErr = classifyError(err, 'dialogue');
          lastError = appErr.message;

          // 不可重试 or 已达最大次数 → 终止
          if (!appErr.retryable || attempt === MAX_RETRIES) {
            setError(lastError);
            console.error(lastError);
            setIsStreaming(false);
            setStreamingText('');
            return fullText || '';
          }

          // 指数退避等待
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`对话重试 ${attempt + 1}/${MAX_RETRIES}，${delay}ms 后…`);
          await new Promise((r) => setTimeout(r, delay));
          // 重置 fullText，重新开始
          fullText = '';
          setStreamingText('');
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      }

      if (lastError) {
        setError(lastError);
      }
      setIsStreaming(false);
      setStreamingText('');
      return fullText || '';
    },
    []
  );

  return { streamingText, isStreaming, error, stream, cancel };
}
