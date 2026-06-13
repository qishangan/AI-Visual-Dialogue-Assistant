import { useRef, useState, useCallback, useEffect } from 'react';

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  error: string | null;
  captureFrame: () => Promise<string | null>;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * 管理摄像头采集与截图。
 * 返回 videoRef（绑定到 <video>）、captureFrame() 方法（返回 JPEG base64）。
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setError(null);

      // 绑定 stream 到 video 元素
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '请允许摄像头权限以使用本功能'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? '未检测到摄像头设备'
            : `摄像头启动失败: ${(err as Error).message}`;
      setError(msg);
    }
  }, []);

  // 组件挂载时自动启动
  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  const captureFrame = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        resolve(null);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(dataUrl);
    });
  }, []);

  return { videoRef, stream, error, captureFrame, start, stop };
}
