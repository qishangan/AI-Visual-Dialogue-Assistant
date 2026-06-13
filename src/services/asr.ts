/**
 * DashScope ASR — 使用 Qwen-ASR 的 OpenAI 兼容 chat/completions 端点。
 * 模型: qwen3-asr-flash（非实时，最大 5 分钟 / 10MB）
 */

const ASR_API_URL = '/api/asr/chat/completions';
const ASR_MODEL = 'qwen3-asr-flash';

/**
 * 将 Float32Array 音频编码为 WAV blob（16kHz PCM16 mono）。
 */
export function encodeWAV(samples: Float32Array, sampleRate: number = 16000): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);    // subchunk1 size
  view.setUint16(20, 1, true);     // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('读取音频失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 一句话识别 — 输入 Float32Array → 编码为 WAV Data URL → chat/completions → 返回文字。
 */
export async function recognizeSpeech(
  audioData: Float32Array
): Promise<string> {
  const wavBlob = encodeWAV(audioData, 16000);
  const wavDataUrl = await blobToDataURL(wavBlob);

  const res = await fetch(ASR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ASR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: wavDataUrl,
              },
            },
          ],
        },
      ],
      stream: false,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = `ASR 请求失败 (${res.status}): ${JSON.stringify(data)}`;
    throw new Error(errMsg);
  }

  if (typeof data.text === 'string') {
    return data.text.trim();
  }

  const text = data.choices?.[0]?.message?.content;
  if (typeof text === 'string') {
    return text.trim();
  }

  throw new Error(`ASR 返回异常: ${JSON.stringify(data)}`);
}
