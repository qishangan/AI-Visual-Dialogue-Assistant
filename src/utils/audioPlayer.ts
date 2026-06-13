/**
 * 顺序播放 TTS 缓存的 MP3 分句（ArrayBuffer[]）。
 * 返回 stop 函数用于中断播放。
 */
export function playAudioChunks(
  chunks: ArrayBuffer[],
  sampleRate = 16000
): { promise: Promise<void>; stop: () => void } {
  let stopped = false;
  let audioCtx: AudioContext | null = null;

  const promise = (async () => {
    audioCtx = new AudioContext({ sampleRate });
    // 移动端可能需要 resume
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    for (const chunk of chunks) {
      if (stopped) break;

      try {
        const audioBuffer = await audioCtx.decodeAudioData(chunk.slice(0));
        if (stopped) break;

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start(0);
        });

        if (stopped) break;
      } catch (err) {
        console.warn('音频解码失败，跳过此句:', err);
      }
    }

    if (audioCtx && audioCtx.state !== 'closed') {
      await audioCtx.close();
    }
  })();

  const stop = () => {
    stopped = true;
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  };

  return { promise, stop };
}
