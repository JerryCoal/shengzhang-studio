import { inspectImageWatermark } from './image-watermark-check.mjs';

// Checking an already-paid image must never discard it or trigger a paid retry.
export async function reviewGeneratedImage(mediaData, config = {}) {
  try { return await (config.imageWatermarkInspector || inspectImageWatermark)(mediaData); }
  catch { return { status: 'unavailable', engine: 'windows-ocr', checkedAt: new Date().toISOString(), regions: [], message: '本机角标检查未完成，图片已保留。请放大原图人工核对。' }; }
}
