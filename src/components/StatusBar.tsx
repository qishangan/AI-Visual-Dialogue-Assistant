import type { AppStatus, VADStatus } from '../types';

interface StatusBarProps {
  status: AppStatus;
  vadStatus: VADStatus;
  vadInitialized: boolean;
  vadPaused?: boolean;
  transcriptionPreview?: string | null;
  isTTSPlaying?: boolean;
  ttsEnabled?: boolean;
  onToggleTTS?: () => void;
  onClear: () => void;
  onStartVAD: () => void;
  onPauseVAD: () => void;
  onResumeVAD: () => void;
}

export function StatusBar({
  status,
  vadStatus,
  vadInitialized,
  vadPaused = false,
  transcriptionPreview,
  isTTSPlaying = false,
  ttsEnabled = true,
  onToggleTTS,
  onClear,
  onStartVAD,
  onPauseVAD,
  onResumeVAD,
}: StatusBarProps) {
  const statusLabel = getStatusLabel(status, vadStatus, vadInitialized, isTTSPlaying, vadPaused);
  const statusIcon = getStatusIcon(status, vadStatus, isTTSPlaying);

  return (
    <div style={styles.container}>
      <div style={styles.left}>
        {/* 麦克风 / 状态图标 */}
        <span
          style={{
            ...styles.icon,
            color:
              vadStatus === 'listening'
                ? 'var(--color-accent)'
                : vadStatus === 'error'
                  ? '#e94560'
                  : vadPaused
                    ? '#ff9800'
                    : isTTSPlaying
                      ? '#4fc3f7'
                      : '#666',
            animation:
              vadStatus === 'listening' || isTTSPlaying
                ? 'pulse 1s ease-in-out infinite'
                : 'none',
          }}
        >
          {statusIcon}
        </span>
        <span style={styles.label}>{statusLabel}</span>

        {/* 实时识别文字预览 */}
        {transcriptionPreview && (
          <span style={styles.preview}>{transcriptionPreview}</span>
        )}

        {/* TTS 播放波形指示 */}
        {isTTSPlaying && (
          <span style={styles.waveform}>
            <span style={{ ...styles.bar, animationDelay: '0s' }} />
            <span style={{ ...styles.bar, animationDelay: '0.15s' }} />
            <span style={{ ...styles.bar, animationDelay: '0.3s' }} />
          </span>
        )}
      </div>

      <div style={styles.right}>
        {/* TTS 自动播放开关 */}
        {onToggleTTS && (
          <button
            style={ttsEnabled ? styles.ttsOnBtn : styles.ttsOffBtn}
            onClick={onToggleTTS}
            title={ttsEnabled ? '关闭语音播报' : '开启语音播报'}
            aria-label={ttsEnabled ? '关闭语音播报' : '开启语音播报'}
          >
            {ttsEnabled ? '🔊' : '🔇'}
          </button>
        )}
        {!vadInitialized && vadStatus !== 'error' ? (
          <button style={styles.startBtn} onClick={onStartVAD}>
            🎤 开始聆听
          </button>
        ) : vadPaused ? (
          <button style={styles.resumeBtn} onClick={onResumeVAD}>
            ▶ 继续
          </button>
        ) : vadStatus === 'listening' || status === 'idle' ? (
          <button style={styles.pauseBtn} onClick={onPauseVAD}>
            ⏸ 暂停
          </button>
        ) : null}
        <button style={styles.clearBtn} onClick={onClear}>
          清除
        </button>
      </div>
    </div>
  );
}

function getStatusLabel(
  status: AppStatus,
  vadStatus: VADStatus,
  initialized: boolean,
  isTTSPlaying: boolean,
  vadPaused: boolean
): string {
  if (!initialized) return '点击右侧按钮开始聆听';
  if (vadPaused) return '已暂停…';
  if (isTTSPlaying) return 'AI 语音播放中…';
  switch (status) {
    case 'listening':
      return '聆听中…';
    case 'processing':
      return '处理中…';
    case 'speaking':
      return 'AI 回复中…';
    case 'idle':
    default:
      return vadStatus === 'error' ? '麦克风异常' : '待机中，请说话…';
  }
}

function getStatusIcon(
  status: AppStatus,
  vadStatus: VADStatus,
  isTTSPlaying: boolean
): string {
  if (vadStatus === 'error') return '⚠️';
  if (isTTSPlaying) return '🔊';
  switch (status) {
    case 'listening':
      return '🎙️';
    case 'processing':
      return '⏳';
    case 'speaking':
      return '💬';
    case 'idle':
    default:
      return '🎤';
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: '1 0 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    backgroundColor: 'var(--color-bg)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    minHeight: 48,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    overflow: 'hidden',
  },
  icon: {
    fontSize: 20,
    lineHeight: 1,
  },
  label: {
    fontSize: 13,
    color: 'var(--color-text-secondary)',
    whiteSpace: 'nowrap',
  },
  preview: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    opacity: 0.7,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 200,
    marginLeft: 8,
  },
  waveform: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 3,
    height: 16,
    marginLeft: 4,
  },
  bar: {
    width: 3,
    height: '100%',
    backgroundColor: '#4fc3f7',
    borderRadius: 2,
    animation: 'wave 0.6s ease-in-out infinite alternate',
  },
  right: {
    flexShrink: 0,
  },
  startBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: 'var(--color-accent)',
    border: 'none',
    borderRadius: 20,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  pauseBtn: {
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#ff9800',
    border: 'none',
    borderRadius: 16,
    cursor: 'pointer',
    marginRight: 6,
  },
  resumeBtn: {
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#4caf50',
    border: 'none',
    borderRadius: 16,
    cursor: 'pointer',
    marginRight: 6,
  },
  clearBtn: {
    padding: '6px 12px',
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    cursor: 'pointer',
  },
  ttsOnBtn: {
    padding: '4px 8px',
    fontSize: 16,
    lineHeight: 1,
    color: '#4fc3f7',
    backgroundColor: 'transparent',
    border: '1px solid rgba(79,195,247,0.3)',
    borderRadius: 8,
    cursor: 'pointer',
    marginRight: 6,
  },
  ttsOffBtn: {
    padding: '4px 8px',
    fontSize: 16,
    lineHeight: 1,
    color: 'var(--color-text-secondary)',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    cursor: 'pointer',
    opacity: 0.5,
    marginRight: 6,
  },
};
