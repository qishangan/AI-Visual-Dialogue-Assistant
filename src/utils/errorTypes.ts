/** 统一应用错误类型 */

export interface AppError {
  /** 机器可读的错误码 */
  code: string;
  /** 用户可读的错误消息 */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
  /** HTTP 状态码（如有） */
  statusCode?: number;
}

/** 从原始 Error 或 HTTP 响应中分类应用错误 */
export function classifyError(
  err: unknown,
  context: 'asr' | 'vlm' | 'tts'
): AppError {
  // 网络中断
  if (err instanceof TypeError && err.message.includes('fetch')) {
    return {
      code: 'NETWORK_OFFLINE',
      message: '网络连接中断，请检查网络后重试',
      retryable: true,
    };
  }

  // 解析 HTTP 响应错误
  const msg = (err as Error)?.message || String(err);

  // HTTP 429 限流
  if (msg.includes('429') || msg.includes('Rate') || msg.includes('Throttle')) {
    return {
      code: 'RATE_LIMITED',
      message: `请求过于频繁（${context.toUpperCase()}），请稍后重试`,
      retryable: true,
      statusCode: 429,
    };
  }

  // HTTP 401 / 403 认证/权限
  if (msg.includes('401') || msg.includes('Unauthorized')) {
    return {
      code: 'AUTH_FAILED',
      message: 'API Key 无效，请检查配置',
      retryable: false,
      statusCode: 401,
    };
  }
  if (msg.includes('403') || msg.includes('Forbidden')) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'API 访问被拒绝，请检查账号权限',
      retryable: false,
      statusCode: 403,
    };
  }

  // HTTP 5xx 服务端错误
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return {
      code: 'SERVER_ERROR',
      message: `服务端异常（${context.toUpperCase()}），请稍后重试`,
      retryable: true,
      statusCode: 500,
    };
  }

  // 通用请求失败
  if (msg.includes('请求失败') || msg.includes('失败')) {
    return {
      code: 'REQUEST_FAILED',
      message: msg,
      retryable: true,
    };
  }

  // 未知错误
  return {
    code: 'UNKNOWN',
    message: `${context.toUpperCase()} 服务异常: ${msg}`,
    retryable: true,
  };
}
