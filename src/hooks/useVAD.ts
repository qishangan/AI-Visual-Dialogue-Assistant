import { useRef, useState, useCallback, useEffect } from 'react';
import type { VADStatus } from '../types';
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import type { MicVAD } from '@ricky0123/vad-web';

interface UseVADCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audioData: Float32Array) => void;
}

interface UseVADResult {
  status: VADStatus;
  initialized: boolean;
  paused: boolean;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}

export function useVAD(callbacks: UseVADCallbacks): UseVADResult {
  const [status, setStatus] = useState<VADStatus>('idle');
  const [initialized, setInitialized] = useState(false);
  const [paused, setPaused] = useState(false);
  const vadRef = useRef<MicVAD | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const start = useCallback(async () => {
    if (vadRef.current) {
      await vadRef.current.start();
      setPaused(false);
      return;
    }

    try {
      const { MicVAD } = await import('@ricky0123/vad-web');

      const vad = await MicVAD.new({
        startOnLoad: true,
        baseAssetPath: '/',
        onnxWASMBasePath: '/',
        ortConfig: (ort: any) => {
          ort.env.wasm.wasmPaths = {
            mjs: ortWasmMjsUrl,
            wasm: ortWasmUrl,
          };
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.simd = false;
        },
        onSpeechStart: () => {
          setStatus('listening');
          callbacksRef.current.onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          setStatus('idle');
          callbacksRef.current.onSpeechEnd?.(audio);
        },
        onVADMisfire: () => {
          setStatus('idle');
        },
      });
      vadRef.current = vad;
      setInitialized(true);
    } catch (err) {
      console.error('VAD 初始化失败:', err);
      setStatus('error');
    }
  }, []);

  const pause = useCallback(async () => {
    await vadRef.current?.pause();
    setStatus('paused');
    setPaused(true);
  }, []);

  const resume = useCallback(async () => {
    await vadRef.current?.start();
    setStatus('idle');
    setPaused(false);
  }, []);

  useEffect(() => {
    return () => {
      vadRef.current?.destroy();
    };
  }, []);

  return { status, initialized, paused, start, pause, resume };
}
