import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { synthesizeSpeech } from '../services/tts';

interface UseTTSResult {
  isPlaying: boolean;
  /** 喂入流式文字，自动检测句末标点分句并合成 */
  feed: (chunk: string) => void;
  /** 冲刷剩余缓冲区文字，返回 Promise 在所有合成完成后 resolve */
  flush: () => Promise<void>;
  /** 停止播放并清空队列 */
  stop: () => void;
  /** 获取并清空本轮已合成的音频分句缓存（用于重播） */
  getAudio: () => ArrayBuffer[];
}

const SENTENCE_END = /[。！？…\n]/;

/**
 * TTS 流式播放 Hook。
 * - 监听 VLM 流式输出，逐 chunk 拼接文字
 * - 检测到句末标点（。！？…）时分句合成
 * - AudioContext 播放队列，前一句播完自动续播
 * - 收集所有合成音频块，供 ChatBubble 重播
 */
export function useTTS(): UseTTSResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const bufferRef = useRef('');

  // 音频缓存：收集本轮所有已合成的分句
  const collectedChunksRef = useRef<ArrayBuffer[]>([]);
  // 正在合成中的句子计数
  const pendingCountRef = useRef(0);
  // flush 完成回调
  const flushResolveRef = useRef<(() => void) | null>(null);

  /** 检查是否所有待合成句子已完成 → 触发 flush resolve */
  const checkFlushComplete = useCallback(() => {
    if (pendingCountRef.current === 0 && flushResolveRef.current) {
      flushResolveRef.current();
      flushResolveRef.current = null;
    }
  }, []);

  /** 惰性初始化 AudioContext */
  const ensureAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      // 移动端可能需要 resume
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    }
    return audioCtxRef.current;
  }, []);

  /** 播放队列中的下一个音频 */
  const playNext = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audioData = queueRef.current.shift()!;

    try {
      const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        // 播放完毕后继续下一个
        playNext();
      };
      source.start(0);
    } catch (err) {
      console.warn('TTS 解码失败，跳过此句:', err);
      // 跳过失败的音频，继续下一个
      playNext();
    }
  }, []);

  /** 将一句文字合成为音频并入队，同时缓存副本 */
  const enqueueSentence = useCallback(
    async (sentence: string) => {
      const trimmed = sentence.trim();
      if (trimmed.length === 0) return;

      pendingCountRef.current++;
      try {
        await ensureAudioContext();
        const audioBuffer = await synthesizeSpeech(trimmed);
        queueRef.current.push(audioBuffer);
        // 缓存副本用于重播
        collectedChunksRef.current.push(audioBuffer.slice(0));

        // 如果当前没有在播放，启动播放
        if (!playingRef.current) {
          playNext();
        }
      } catch (err) {
        console.error('TTS 合成失败:', err);
        // TTS 失败不影响文字显示，静默跳过
      } finally {
        pendingCountRef.current--;
        checkFlushComplete();
      }
    },
    [ensureAudioContext, playNext, checkFlushComplete]
  );

  /** 喂入流式文字 chunk */
  const feed = useCallback(
    (chunk: string) => {
      bufferRef.current += chunk;

      // 检测句末标点，分句发送
      let match: RegExpExecArray | null;
      while ((match = SENTENCE_END.exec(bufferRef.current)) !== null) {
        const endIdx = match.index + match[0].length;
        const sentence = bufferRef.current.slice(0, endIdx);
        bufferRef.current = bufferRef.current.slice(endIdx);

        // 异步合成（不阻塞文字显示）
        enqueueSentence(sentence);
      }
    },
    [enqueueSentence]
  );

  /** 冲刷剩余缓冲区，返回 Promise 在所有合成完成后 resolve */
  const flush = useCallback((): Promise<void> => {
    if (bufferRef.current.trim().length > 0) {
      enqueueSentence(bufferRef.current);
      bufferRef.current = '';
    }

    return new Promise<void>((resolve) => {
      if (pendingCountRef.current === 0) {
        resolve();
      } else {
        flushResolveRef.current = resolve;
      }
    });
  }, [enqueueSentence]);

  /** 停止播放并清空所有状态 */
  const stop = useCallback(() => {
    queueRef.current = [];
    bufferRef.current = '';
    collectedChunksRef.current = [];
    pendingCountRef.current = 0;
    flushResolveRef.current = null;
    playingRef.current = false;
    setIsPlaying(false);
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  /** 获取并清空本轮已合成的音频分句缓存 */
  const getAudio = useCallback((): ArrayBuffer[] => {
    const chunks = collectedChunksRef.current.slice();
    collectedChunksRef.current = [];
    return chunks;
  }, []);

  // 组件卸载时清理 AudioContext
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // 稳定返回引用，避免 consumer useEffect 不必要的重跑
  return useMemo(
    () => ({ isPlaying, feed, flush, stop, getAudio }),
    [isPlaying, feed, flush, stop, getAudio]
  );
}
