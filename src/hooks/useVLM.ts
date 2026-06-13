import { useState, useCallback, useRef } from 'react';
import { streamChat, buildVLMMessages } from '../services/vlm';
import { classifyError } from '../utils/errorTypes';
import type { Message } from '../types';

interface UseVLMResult {
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  /** 发起 VLM 流式请求，返回完整文字 */
  stream: (params: {
    userText: string;
    imageBase64?: string;
    history: Message[];
  }) => Promise<string>;
  cancel: () => void;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1500;

/**
 * 管理通义千问 VL 流式调用。
 * 逐 chunk 追加 streamingText，返回最终完整文字。
 * 对 retryable 错误（限流、服务端错误）自动指数退避重试。
 */
export function useVLM(): UseVLMResult {
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
      imageBase64,
      history,
    }: {
      userText: string;
      imageBase64?: string;
      history: Message[];
    }): Promise<string> => {
      setIsStreaming(true);
      setStreamingText('');
      setError(null);

      let fullText = '';
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const vlmMessages = buildVLMMessages(history, userText, imageBase64);

          for await (const chunk of streamChat(vlmMessages)) {
            fullText += chunk;
            setStreamingText((prev) => prev + chunk);
          }

          // 成功 → 清理流式状态再返回
          setIsStreaming(false);
          setStreamingText('');
          return fullText;
        } catch (err) {
          const appErr = classifyError(err, 'vlm');
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
          console.warn(`VLM 重试 ${attempt + 1}/${MAX_RETRIES}，${delay}ms 后…`);
          await new Promise((r) => setTimeout(r, delay));
          // 重置 fullText，重新开始
          fullText = '';
          setStreamingText('');
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
