export type Role = 'user' | 'assistant' | 'system';

export type AppStatus = 'idle' | 'listening' | 'processing' | 'speaking';

export interface Message {
  id: string;
  role: Role;
  text: string;
  imageBase64?: string;
  /** 该轮截图的客观视觉转写，用于后续追问上下文 */
  visualDescription?: string;
  timestamp: number;
  /** AI 消息的 TTS 音频分句缓存（MP3 ArrayBuffer），用于重播 */
  audioChunks?: ArrayBuffer[];
}

export interface ChatState {
  messages: Message[];
  status: AppStatus;
}

export type VADStatus = 'idle' | 'listening' | 'paused' | 'error';

export interface VADCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: (audioData: Float32Array) => void;
  onVADMisfire: () => void;
}

export interface ImageCompressOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}
