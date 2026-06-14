import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { join } from 'path';

// 直接解析 .env 文件，避免 loadEnv prefix 问题
function loadEnvFile(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const content = readFileSync(join(root, '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      result[key] = value.replace(/^["']|["']$/g, '');
    }
  } catch { /* .env 不存在 */ }
  return result;
}

export default defineConfig(({ mode }) => {
  const envVars = loadEnvFile(process.cwd());
  const dashscopeApiKey =
    envVars.VITE_DASHSCOPE_API_KEY ||
    envVars.DASHSCOPE_API_KEY ||
    process.env.VITE_DASHSCOPE_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    '';
  const deepseekApiKey =
    envVars.VITE_DEEPSEEK_API_KEY ||
    envVars.DEEPSEEK_API_KEY ||
    process.env.VITE_DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    '';

  const createDashscopeProxy = (rewritePath: string): ProxyOptions => ({
    target: 'https://dashscope.aliyuncs.com',
    changeOrigin: true,
    secure: true,
    rewrite: () => rewritePath,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        if (dashscopeApiKey) {
          proxyReq.setHeader('Authorization', `Bearer ${dashscopeApiKey}`);
        }
        proxyReq.removeHeader('origin');
      });
    },
  });
  const deepseekProxy: ProxyOptions = {
    target: 'https://api.deepseek.com',
    changeOrigin: true,
    secure: true,
    rewrite: () => '/chat/completions',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        if (deepseekApiKey) {
          proxyReq.setHeader('Authorization', `Bearer ${deepseekApiKey}`);
        }
        proxyReq.removeHeader('origin');
      });
    },
  };

  const apiProxy = {
    '/api/asr/chat/completions': createDashscopeProxy(
      '/compatible-mode/v1/chat/completions'
    ),
    '/api/vlm/chat/completions': createDashscopeProxy(
      '/compatible-mode/v1/chat/completions'
    ),
    '/api/tts/synthesize': createDashscopeProxy(
      '/api/v1/services/aigc/multimodal-generation/generation'
    ),
    '/api/deepseek/chat/completions': deepseekProxy,
  };

  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: apiProxy,
    },
    preview: {
      host: true,
      proxy: apiProxy,
    },
    optimizeDeps: {
      include: ['@ricky0123/vad-web', 'onnxruntime-web', 'onnxruntime-web/wasm'],
    },
  };
});
