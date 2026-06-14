import { SPATIAL_KEYWORDS } from './constants';

export interface IntentResult {
  /** 是否需要发送图片给 VLM */
  needsImage: boolean;
  /** 命中的关键词（调试用） */
  matchedKeywords: string[];
}

/**
 * 基于关键词规则的意图分类。
 * 命中任一空间指代词 / 视觉请求关键词 → needsImage = true。
 * 否则仅发送文字（不消耗图片 token）。
 *
 * 边界处理：
 * - 空字符串 / 纯空白 → needsImage = false
 * - 纯英文 → 检查小写后的关键词
 * - 调试模式下 console.log 命中详情
 */
export function classifyIntent(transcription: string): IntentResult {
  // 空输入
  if (!transcription || transcription.trim().length === 0) {
    return { needsImage: false, matchedKeywords: [] };
  }

  const text = transcription.toLowerCase();
  const matchedKeywords = SPATIAL_KEYWORDS.filter((kw) => text.includes(kw));

  // 调试日志
  if (import.meta.env.DEV && matchedKeywords.length > 0) {
    console.debug(
      `[Intent] 命中关键词: [${matchedKeywords.join(', ')}] → 发送图片`,
      { transcription }
    );
  } else if (import.meta.env.DEV) {
    console.debug('[Intent] 未命中关键词 → 仅文字', { transcription });
  }

  return {
    needsImage: matchedKeywords.length > 0,
    matchedKeywords,
  };
}
