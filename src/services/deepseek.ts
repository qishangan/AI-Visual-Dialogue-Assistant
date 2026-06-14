import { DEEPSEEK_API_URL, DEEPSEEK_MODEL, SYSTEM_PROMPT } from '../utils/constants';
import type { Message } from '../types';

interface DeepSeekRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildDeepSeekMessages(
  history: Message[],
  userText: string,
  imageDescription?: string
): DeepSeekRequestMessage[] {
  const messages: DeepSeekRequestMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  for (const msg of history) {
    if (msg.role === 'system') {
      messages.push({ role: 'system', content: msg.text });
      continue;
    }

    const content = buildHistoryContent(msg);
    if (!content) continue;

    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content,
    });
  }

  const contextExcerpt = buildContextExcerpt(history);
  if (contextExcerpt) {
    messages.push({
      role: 'system',
      content:
        '最近对话摘录如下。当前问题如果是追问、代词或省略表达，必须优先依据这段上下文回答，不要把它当成全新的独立问题。\n' +
        contextExcerpt,
    });
  }

  messages.push({
    role: 'user',
    content: buildCurrentTurn(userText, imageDescription),
  });

  return messages;
}

export async function* streamAnswer(
  history: Message[],
  userText: string,
  imageDescription?: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: buildDeepSeekMessages(history, userText, imageDescription),
      stream: true,
      thinking: { type: 'disabled' },
      temperature: 0.2,
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(formatDeepSeekError(res.status, errorBody));
  }

  if (!res.body) {
    throw new Error('DeepSeek 响应无 body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      const delta = parseDelta(dataStr);
      if (delta) {
        yield delta;
      }
    }
  }
}

function buildCurrentTurn(userText: string, imageDescription?: string): string {
  const trimmedDescription = imageDescription?.trim();
  if (!trimmedDescription) {
    return `学生本轮问题：${userText}`;
  }

  return [
    `学生本轮问题：${userText}`,
    '',
    '本轮图片转写（视觉模型已读取图片，只是辅助事实）：',
    trimmedDescription,
    '',
    '如果这段图片转写与问题有关，请直接依据它回答，不要说看不到图片；如果无关，请忽略它，直接根据文字和上下文回答。',
  ].join('\n');
}

function buildHistoryContent(message: Message): string {
  const text = message.text.trim();
  if (!text) return '';
  if (message.role !== 'user' || !message.visualDescription?.trim()) {
    return text;
  }

  return [
    text,
    '',
    '历史图片转写（来自该轮自动截图）：',
    trimVisualDescription(message.visualDescription),
  ].join('\n');
}

function buildContextExcerpt(history: Message[]): string {
  return history
    .slice(-6)
    .map((message) => {
      const text = message.text.trim();
      if (!text) return '';

      const role = message.role === 'assistant' ? '助手' : '学生';
      const base = `${role}：${trimForContext(text)}`;
      if (message.role === 'user' && message.visualDescription?.trim()) {
        return `${base}；图片转写：${trimForContext(message.visualDescription)}`;
      }
      return base;
    })
    .filter(Boolean)
    .join('\n');
}

function trimVisualDescription(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= 700 ? normalized : `${normalized.slice(0, 700)}...`;
}

function trimForContext(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 180)}...`;
}

function parseDelta(data: string): string {
  try {
    const parsed = JSON.parse(data);
    const delta = parsed.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  } catch {
    return '';
  }
}

function formatDeepSeekError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    let message = parsed.message ? String(parsed.message) : body;
    if (parsed.code) {
      message += ` [code: ${parsed.code}]`;
    }
    return `DeepSeek 请求失败 (${status}): ${message}`;
  } catch {
    return `DeepSeek 请求失败 (${status}): ${body}`;
  }
}
