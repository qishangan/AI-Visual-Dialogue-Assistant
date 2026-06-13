import imageCompression from 'browser-image-compression';
import { IMAGE_COMPRESS_OPTIONS } from '../utils/constants';

/**
 * 将 base64 图片压缩至 720p。
 * 输入 base64 JPEG，输出压缩后的 base64 JPEG。
 */
export async function compressImage(base64: string): Promise<string> {
  // base64 → Blob
  const res = await fetch(base64);
  const blob = await res.blob();

  // 压缩（browser-image-compression 接受 File；Blob 可 cast）
  const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
  const compressedBlob = await imageCompression(file, {
    maxSizeMB: 0.3,
    maxWidthOrHeight: 720,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: IMAGE_COMPRESS_OPTIONS.quality,
  });

  // Blob → base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(compressedBlob);
  });
}

export interface CropRectCSS {
  /** 左上角 x，相对 video 容器 CSS px */
  x: number;
  /** 左上角 y */
  y: number;
  /** 宽度 CSS px */
  width: number;
  /** 高度 CSS px */
  height: number;
}

/**
 * 从 video 元素捕获指定区域的截图（已压缩）。
 *
 * 自动处理 CSS 坐标 → 视频原生分辨率 的转换，
 * 并适配 object-fit: cover 的缩放偏移。
 *
 * @param video   HTMLVideoElement（readyState ≥ 2）
 * @param cssRect 用户在 CSS 容器上拖出的选区（CSS px）
 * @returns       压缩后的 base64 JPEG（data URI）
 */
export async function cropFromVideo(
  video: HTMLVideoElement,
  cssRect: CropRectCSS
): Promise<string> {
  const container = video.parentElement;
  if (!container) {
    throw new Error('无法获取视频容器');
  }

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;

  if (!videoW || !videoH) {
    throw new Error('视频分辨率未知');
  }

  // 计算 object-fit: cover 的缩放偏移量
  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;

  let scale: number;
  let offsetX = 0;
  let offsetY = 0;

  if (containerAspect > videoAspect) {
    // 容器更宽 → 视频按高度撑满，左右有隐藏部分
    scale = containerH / videoH;
    const displayedWidth = videoW * scale;
    offsetX = (containerW - displayedWidth) / 2;
  } else {
    // 容器更高 → 视频按宽度撑满，上下有隐藏部分
    scale = containerW / videoW;
    const displayedHeight = videoH * scale;
    offsetY = (containerH - displayedHeight) / 2;
  }

  // CSS 坐标 → 视频原生坐标
  const nativeX = (cssRect.x - offsetX) / scale;
  const nativeY = (cssRect.y - offsetY) / scale;
  const nativeW = cssRect.width / scale;
  const nativeH = cssRect.height / scale;

  // 裁剪：绘制到 canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(nativeW);
  canvas.height = Math.round(nativeH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 canvas 上下文');
  }

  ctx.drawImage(
    video,
    nativeX,
    nativeY,
    nativeW,
    nativeH, // 源区域
    0,
    0,
    nativeW,
    nativeH // 目标区域
  );

  const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // 对裁剪结果再做一次压缩（限制尺寸）
  return compressImage(croppedDataUrl);
}

/**
 * 将 raw JPEG base64 转为带 data URI 前缀的字符串。
 */
export function toDataURI(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}
