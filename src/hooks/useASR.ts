import { useState, useCallback, useRef } from 'react';
import { recognizeSpeech } from '../services/asr';
import { classifyError } from '../utils/errorTypes';

interface UseASRResult {
  transcription: string | null;
  isProcessing: boolean;
  error: string | null;
  recognize: (audioData: Float32Array) => Promise<string | null>;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

/**
 * 管理 ASR 识别流程 — 使用 DashScope 端点。
 * 自动分类错误类型，对 retryable 错误执行指数退避重试（最多 2 次）。
 */
export function useASR(): UseASRResult {
  const [transcription, setTranscription] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const recognize = useCallback(
    async (audioData: Float32Array): Promise<string | null> => {
      setIsProcessing(true);
      setError(null);
      abortRef.current = false;

      let lastError: string | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (abortRef.current) break;

        try {
          const text = await recognizeSpeech(audioData);
          setTranscription(text);
          return text;
        } catch (err) {
          const appErr = classifyError(err, 'asr');
          lastError = appErr.message;

          // 不可重试 or 已达最大次数 → 终止
          if (!appErr.retryable || attempt === MAX_RETRIES) {
            setError(lastError);
            console.error(lastError);
            setIsProcessing(false);
            return null;
          }

          // 指数退避等待
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`ASR 重试 ${attempt + 1}/${MAX_RETRIES}，${delay}ms 后…`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (lastError) {
        setError(lastError);
      }
      setIsProcessing(false);
      return null;
    },
    []
  );

  return { transcription, isProcessing, error, recognize };
}
