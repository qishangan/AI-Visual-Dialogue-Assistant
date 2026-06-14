import { useState, useCallback, useEffect } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'error' | 'info';
  onRetry?: () => void;
}

/**
 * 全局 Toast 通知系统。
 * 调用 showToast(message, type, onRetry?) 显示通知，3 秒后自动消失。
 * 对 error 类型可传入 onRetry 回调，Toast 上将显示「重试」按钮。
 */
let toastId = 0;
let globalShowToast: ((msg: string, type?: 'error' | 'info', onRetry?: () => void) => void) | null = null;

export function showToast(
  message: string,
  type: 'error' | 'info' = 'error',
  onRetry?: () => void
) {
  globalShowToast?.(message, type, onRetry);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, type: 'error' | 'info' = 'error', onRetry?: () => void) => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type, onRetry }]);

      // 3 秒后自动移除
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  useEffect(() => {
    globalShowToast = addToast;
    return () => {
      globalShowToast = null;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div style={styles.container}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            ...styles.toast,
            backgroundColor:
              toast.type === 'error' ? 'rgba(233,69,96,0.9)' : 'rgba(15,52,96,0.9)',
          }}
        >
          <span style={styles.icon}>
            {toast.type === 'error' ? '⚠️' : 'ℹ️'}
          </span>
          <span style={styles.message}>{toast.message}</span>
          {toast.onRetry && (
            <button
              style={styles.retryBtn}
              onClick={(e) => {
                e.stopPropagation();
                setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                toast.onRetry?.();
              }}
            >
              重试
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    animation: 'toastIn 0.3s ease-out',
    backdropFilter: 'blur(8px)',
  },
  icon: {
    fontSize: 16,
  },
  message: {
    lineHeight: 1.4,
    flex: 1,
  },
  retryBtn: {
    marginLeft: 8,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.2)',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
