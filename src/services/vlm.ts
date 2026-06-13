import { VLM_API_URL, VLM_MODEL, SYSTEM_PROMPT } from '../utils/constants';
import type { Message } from '../types';

interface VLMMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface VLMRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | VLMMessageContent[];
}

/**
 * 将应用 Message 数组转换为 VLM 请求格式。
 * - system 消息（摘要）以 role: 'system' 注入
 * - 历史对话中图片只在首次提问时附带
 * - 当前消息可能附带图片
 */
export function buildVLMMessages(
  messages: Message[],
  currentText: string,
  currentImageBase64?: string
): VLMRequestMessage[] {
  const result: VLMRequestMessage[] = [];

  // System prompt（始终在最前）
  result.push({ role: 'system', content: SYSTEM_PROMPT });

  // 历史消息（最近若干条）
  for (const msg of messages) {
    if (msg.role === 'system') {
      // 摘要消息 → 注入为 system
      result.push({ role: 'system', content: msg.text });
    } else {
      // 普通 user/assistant 消息（纯文字，历史图片不发）
      result.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text,
      });
    }
  }

  // 当前用户消息（可能附带图片）
  if (currentImageBase64) {
    const content: VLMMessageContent[] = [
      { type: 'text', text: currentText },
      {
        type: 'image_url',
        image_url: { url: currentImageBase64 },
      },
    ];
    result.push({ role: 'user', content });
  } else {
    result.push({ role: 'user', content: currentText });
  }

  return result;
}

/**
 * 流式调用通义千问 VL。
 * 返回 AsyncGenerator，逐 chunk yield delta 文字。
 */
export async function* streamChat(
  messages: VLMRequestMessage[],
  model: string = VLM_MODEL
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(VLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let errMsg = `VLM 请求失败 (${res.status}): ${errorBody}`;
    // 附加错误体中的详细信息
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.message) {
        errMsg = `VLM 请求失败 (${res.status}): ${parsed.message}`;
      }
      if (parsed.code) {
        errMsg += ` [code: ${parsed.code}]`;
      }
    } catch { /* ignore parse failure */ }
    throw new Error(errMsg);
  }

  if (!res.body) {
    throw new Error('VLM 响应无 body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // 保留最后一个未完成的行
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') return;

      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      } catch {
        // 忽略解析失败的行
      }
    }
  }
}
