const TTS_API_URL = '/api/tts/synthesize';
const TTS_MODEL = 'qwen3-tts-flash';
const TTS_VOICE = 'Cherry';
const TTS_LANGUAGE = 'Chinese';

interface TTSResponse {
  output?: {
    finish_reason?: string;
    audio?: {
      data?: string;
      url?: string;
    };
  };
  code?: string;
  message?: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function concatArrayBuffers(chunks: ArrayBuffer[]): ArrayBuffer {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

function audioFromJson(data: TTSResponse): ArrayBuffer | null {
  if (!data.output?.audio?.data) {
    return null;
  }

  return base64ToArrayBuffer(data.output.audio.data);
}

async function parseTTSStream(res: Response): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('TTS 响应没有 body');
  }

  const decoder = new TextDecoder();
  const audioChunks: ArrayBuffer[] = [];
  let buffer = '';
  let apiError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const parsed: TTSResponse = JSON.parse(dataStr);
        if (parsed.message) {
          apiError = parsed.code
            ? `${parsed.message} [code: ${parsed.code}]`
            : parsed.message;
        }

        const audio = audioFromJson(parsed);
        if (audio) {
          audioChunks.push(audio);
        }
      } catch {
        // Ignore malformed SSE lines.
      }
    }
  }

  if (audioChunks.length > 0) {
    return concatArrayBuffers(audioChunks);
  }

  throw new Error(apiError ? `TTS 合成失败: ${apiError}` : 'TTS 合成失败: 未返回音频');
}

/**
 * Calls DashScope Qwen-TTS and returns playable audio bytes.
 */
export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const res = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'enable',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: {
        text,
        voice: TTS_VOICE,
        language_type: TTS_LANGUAGE,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    let errMsg = `TTS 合成失败 (${res.status}): ${errBody}`;
    try {
      const parsed = JSON.parse(errBody);
      if (parsed.message) {
        errMsg = `TTS 合成失败 (${res.status}): ${parsed.message}`;
      }
      if (parsed.code) {
        errMsg += ` [code: ${parsed.code}]`;
      }
    } catch {
      // Keep the raw response body.
    }
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return parseTTSStream(res);
  }

  if (contentType.includes('application/json')) {
    const data: TTSResponse = await res.json();
    const audio = audioFromJson(data);
    if (audio) {
      return audio;
    }

    if (data.output?.audio?.url) {
      const audioRes = await fetch(data.output.audio.url);
      if (!audioRes.ok) {
        throw new Error(`TTS 音频下载失败 (${audioRes.status})`);
      }
      return audioRes.arrayBuffer();
    }

    if (data.message) {
      throw new Error(`TTS 合成失败: ${data.message}`);
    }

    throw new Error('TTS 合成失败: 未返回音频');
  }

  return res.arrayBuffer();
}
