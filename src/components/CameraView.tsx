import { useState, useCallback, useRef } from 'react';
import type { AppStatus } from '../types';

export interface SelectionRect {
  /** 选区左上角 x，相对 video 容器左上角（CSS px） */
  x: number;
  /** 选区左上角 y */
  y: number;
  /** 选区宽度（CSS px） */
  width: number;
  /** 选区高度（CSS px） */
  height: number;
}

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: AppStatus;
  error: string | null;
  onSelectionChange?: (rect: SelectionRect | null) => void;
}

const MIN_DRAG_DISTANCE = 15;

/**
 * 摄像头实时画面组件（占上方 60%）。
 * 支持触摸/鼠标拖拽框选：长按拖拽绘制选区，松手确认。
 * 画面全宽显示；processing 时加半透明遮罩。
 */
export function CameraView({
  videoRef,
  status,
  error,
  onSelectionChange,
}: CameraViewProps) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const rectRef = useRef<DOMRect | null>(null);

  const getRelativePos = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      if (!rectRef.current) {
        rectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
      }
      const r = rectRef.current;
      if (!r) return { x: clientX, y: clientY };
      return {
        x: Math.max(0, Math.min(r.width, clientX - r.left)),
        y: Math.max(0, Math.min(r.height, clientY - r.top)),
      };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 仅在 idle/listening 状态允许框选
      if (status === 'processing' || status === 'speaking') return;
      rectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
      const pos = getRelativePos(e.clientX, e.clientY);
      startPosRef.current = pos;
      setSelecting(true);
      setSelection(null);
      onSelectionChange?.(null);
      // 阻止默认，避免移动端触发页面滚动
      e.preventDefault();
    },
    [status, getRelativePos, onSelectionChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!selecting || !startPosRef.current) return;
      const pos = getRelativePos(e.clientX, e.clientY);
      const sx = startPosRef.current.x;
      const sy = startPosRef.current.y;

      const rect: SelectionRect = {
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        width: Math.abs(pos.x - sx),
        height: Math.abs(pos.y - sy),
      };

      setSelection(rect);
      e.preventDefault();
    },
    [selecting, getRelativePos]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!selecting || !startPosRef.current) return;
      const pos = getRelativePos(e.clientX, e.clientY);
      const sx = startPosRef.current.x;
      const sy = startPosRef.current.y;

      const dx = Math.abs(pos.x - sx);
      const dy = Math.abs(pos.y - sy);

      if (dx < MIN_DRAG_DISTANCE && dy < MIN_DRAG_DISTANCE) {
        // 拖拽距离太小 → 取消
        setSelection(null);
        onSelectionChange?.(null);
      } else {
        const rect: SelectionRect = {
          x: Math.min(sx, pos.x),
          y: Math.min(sy, pos.y),
          width: dx,
          height: dy,
        };
        setSelection(rect);
        onSelectionChange?.(rect);
      }

      setSelecting(false);
      startPosRef.current = null;
      e.preventDefault();
    },
    [selecting, getRelativePos, onSelectionChange]
  );

  // 清除选区
  const handleClearSelection = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelection(null);
      onSelectionChange?.(null);
    },
    [onSelectionChange]
  );

  return (
    <div ref={containerRef} style={styles.container}>
      {error ? (
        <div style={styles.errorOverlay}>
          <span style={styles.errorIcon}>📷</span>
          <p style={styles.errorText}>{error}</p>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ ...styles.video, touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />

          {/* 框选蒙层 */}
          {(selection || selecting) && (
            <div style={styles.selectionOverlay} onPointerDown={handlePointerDown}>
              {selection && (
                <>
                  {/* 半透明蓝色蒙层 — 使用四个 div 拼出挖空效果 */}
                  <div
                    style={{
                      ...styles.mask,
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: selection.y,
                    }}
                  />
                  <div
                    style={{
                      ...styles.mask,
                      top: selection.y + selection.height,
                      left: 0,
                      width: '100%',
                      height: `calc(100% - ${selection.y + selection.height}px)`,
                    }}
                  />
                  <div
                    style={{
                      ...styles.mask,
                      top: selection.y,
                      left: 0,
                      width: selection.x,
                      height: selection.height,
                    }}
                  />
                  <div
                    style={{
                      ...styles.mask,
                      top: selection.y,
                      left: selection.x + selection.width,
                      width: `calc(100% - ${selection.x + selection.width}px)`,
                      height: selection.height,
                    }}
                  />
                  {/* 选区边框 */}
                  <div
                    style={{
                      ...styles.selectionBorder,
                      left: selection.x,
                      top: selection.y,
                      width: selection.width,
                      height: selection.height,
                    }}
                  />
                  {/* 清除按钮 */}
                  <button
                    style={styles.clearSelectionBtn}
                    onClick={handleClearSelection}
                    title="取消框选"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )}

          {status === 'processing' && (
            <div style={styles.thinkingOverlay}>
              <div style={styles.thinkingDots}>
                <span style={styles.dot}>●</span>
                <span style={styles.dot}>●</span>
                <span style={styles.dot}>●</span>
              </div>
              <p style={styles.thinkingText}>思考中…</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: '6 0 0',
    position: 'relative',
    backgroundColor: '#000',
    overflow: 'hidden',
    minHeight: 0,
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--color-bg-secondary)',
    padding: 24,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  thinkingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--color-overlay)',
  },
  thinkingDots: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    fontSize: 12,
    color: '#fff',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  thinkingText: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.8,
  },
  selectionOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    pointerEvents: 'auto',
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 100, 200, 0.3)',
  },
  selectionBorder: {
    position: 'absolute',
    border: '2px solid rgba(0, 150, 255, 0.8)',
    borderRadius: 4,
    pointerEvents: 'none',
  },
  clearSelectionBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '50%',
    cursor: 'pointer',
    zIndex: 6,
  },
};
