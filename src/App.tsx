import { useCallback, useState } from 'react';
import { CameraView, type SelectionRect } from './components/CameraView';
import { useCamera } from './hooks/useCamera';
import { compressImage, cropFromVideo, type CropRectCSS } from './services/imageProcessor';

export default function App() {
  const camera = useCamera();
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    const video = camera.videoRef.current;
    if (selection && video && video.readyState >= 2) {
      const cssRect: CropRectCSS = {
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
      };
      setPreview(await cropFromVideo(video, cssRect));
      return;
    }

    const frame = await camera.captureFrame();
    setPreview(frame ? await compressImage(frame) : null);
  }, [camera, selection]);

  return (
    <main style={styles.shell}>
      <section style={styles.cameraPane}>
        <CameraView
          videoRef={camera.videoRef}
          status="idle"
          error={camera.error}
          onSelectionChange={setSelection}
        />
      </section>

      <aside style={styles.sidePane}>
        <p style={styles.eyebrow}>Camera Selection</p>
        <h1 style={styles.title}>框选题目区域</h1>
        <p style={styles.copy}>
          在摄像头画面中拖拽框选题目，然后点击截图预览。后续语音对话会优先上传这个区域，
          用来减少无关背景和视觉 token。
        </p>
        <button style={styles.button} onClick={handleCapture}>
          生成截图预览
        </button>
        <p style={styles.meta}>
          {selection
            ? `选区：${Math.round(selection.width)} x ${Math.round(selection.height)}`
            : '未框选时会截取整张画面'}
        </p>
        {preview && <img src={preview} alt="截图预览" style={styles.preview} />}
      </aside>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    height: '100vh',
    background: 'var(--color-bg)',
  },
  cameraPane: {
    minHeight: 0,
    display: 'flex',
  },
  sidePane: {
    padding: 24,
    background: 'var(--color-bg-secondary)',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    overflowY: 'auto',
  },
  eyebrow: {
    margin: '0 0 8px',
    fontSize: 12,
    color: 'var(--color-accent)',
    textTransform: 'uppercase',
  },
  title: {
    margin: '0 0 12px',
    fontSize: 24,
    color: 'var(--color-text)',
  },
  copy: {
    margin: '0 0 18px',
    fontSize: 14,
    lineHeight: 1.7,
    color: 'var(--color-text-secondary)',
  },
  button: {
    width: '100%',
    padding: '12px 14px',
    border: 0,
    borderRadius: 8,
    background: 'var(--color-accent)',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  meta: {
    margin: '12px 0',
    fontSize: 13,
    color: 'var(--color-text-secondary)',
  },
  preview: {
    width: '100%',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
  },
};
