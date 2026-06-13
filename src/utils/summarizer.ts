import type { Message } from '../types';

/**
 * 规则摘要：将对话历史压缩为一句简短摘要。
 * 用于超过 MAX_CHAT_ROUNDS 轮后，将最早一轮替换为摘要。
 *
 * 当前采用无成本规则方案：
 * - 提取用户问题的前 15 字符
 * - 提取 AI 回复的前 20 字符
 * - 拼成「用户问了 X，AI 引导了 Y」
 *
 * 后续可升级为调用轻量模型生成摘要。
 */
export function summarizeRound(userMsg: Message, assistantMsg: Message): string {
  const userSnippet = truncate(userMsg.text, 18);
  const assistantSnippet = truncate(assistantMsg.text, 24);

  return `[上文摘要] 学生问了「${userSnippet}」，助手引导了「${assistantSnippet}」`;
}

/**
 * 将超限的消息列表压缩：保留最近 maxRounds 轮完整消息，
 * 之前的消息合并为一条摘要注入。
 *
 * @param messages  原始消息列表
 * @param maxRounds 保留的完整轮数（1 轮 = 用户 + 助手）
 * @returns 压缩后的消息列表
 */
export function compressHistory(
  messages: Message[],
  maxRounds: number
): Message[] {
  const maxMessages = maxRounds * 2;

  if (messages.length <= maxMessages) {
    return messages;
  }

  // 收集需要摘要的旧消息
  const oldMessages = messages.slice(0, messages.length - maxMessages);
  const recentMessages = messages.slice(-maxMessages);

  // 按轮次配对 (user, assistant)，生成摘要
  const summaries: string[] = [];
  for (let i = 0; i < oldMessages.length; i += 2) {
    const userMsg = oldMessages[i];
    const assistantMsg = oldMessages[i + 1];
    if (userMsg && assistantMsg) {
      summaries.push(summarizeRound(userMsg, assistantMsg));
    } else if (userMsg) {
      summaries.push(`[上文] 学生问了「${truncate(userMsg.text, 30)}」`);
    }
  }

  // 将摘要注入为 system 消息（role 用 'system' 标记历史摘要）
  const summaryMsg: Message = {
    id: 'summary',
    role: 'system',
    text: summaries.join('；'),
    timestamp: Date.now(),
  };

  return [summaryMsg, ...recentMessages];
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}
