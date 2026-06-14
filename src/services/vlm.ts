import { VISION_TRANSCRIPTION_PROMPT, VLM_API_URL, VLM_MODEL } from '../utils/constants';

interface VLMMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface VLMRequestMessage {
  role: 'system' | 'user';
  content: string | VLMMessageContent[];
}

/**
 * 使用视觉模型做客观图片转写。
 * 该阶段只把图片转成文字事实，不直接解题，最终回答交给 DeepSeek 完成。
 */
export async function describeImage(imageDataUrl: string): Promise<string> {
  if (!imageDataUrl.trim()) {
    return '';
  }

  const messages: VLMRequestMessage[] = [
    {
      role: 'system',
      content:
        '你是视觉转写模型。你的任务是把图片内容转成客观文字描述，禁止直接解题、禁止给建议、禁止代替最终助手回答。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_TRANSCRIPTION_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const res = await fetch(VLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages,
      stream: false,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(formatApiError('图片转写失败', res.status, data));
  }

  const text = data.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : '';
}

function formatApiError(prefix: string, status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(data);
    const code = typeof record.code === 'string' ? ` [code: ${record.code}]` : '';
    return `${prefix} (${status}): ${message}${code}`;
  }
  return `${prefix} (${status}): ${String(data)}`;
}
