import { Capacitor } from '@capacitor/core';
import { api, API_BASE, download, LOCAL_DATA } from './api';
import { contentArchive, exportDetails } from '../server/content-export.mjs';
import type { Asset, Publication } from './types';
export type ExportOptions = { mode?: 'package' | 'media' | 'copy'; imageFormat?: 'original' | 'png' | 'jpeg' };
export async function prepareExport(content: Asset | Publication, imageFormat: ExportOptions['imageFormat'] = 'original') {
  exportDetails(content);
  if (!content.mime.startsWith('image/') || imageFormat === 'original' || content.mime === `image/${imageFormat}`) return content;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片无法读取，请重新制作后导出')); image.src = content.mediaData; });
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前环境无法转换图片格式，请选择保留原格式');
  if (imageFormat === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(image, 0, 0);
  const mime = `image/${imageFormat}`, mediaData = canvas.toDataURL(mime, .94);
  if (!mediaData.startsWith(`data:${mime};base64,`)) throw new Error('图片格式转换未完成，请选择保留原格式');
  return { ...content, mime, mediaData };
}
async function save(data: Blob, filename: string, title: string) {
  if (!Capacitor.isNativePlatform()) { download(data, filename); return; }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const bytes = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('无法保存文件，请重试')); reader.readAsDataURL(data); });
  const { uri } = await Filesystem.writeFile({ path: `exports/${Date.now()}-${filename}`, data: bytes, directory: Directory.Cache, recursive: true });
  await Share.share({ title, files: [uri] });
}
export async function exportContent(content: Asset | Publication, projectId: string, options: ExportOptions = {}) {
  const mode = options.mode || 'package', imageFormat = options.imageFormat || 'original';
  const info = exportDetails(content);
  if (mode === 'copy') {
    await save(new Blob(['\ufeff', `${content.title}\n\n${content.body}`.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), `${info.stem}-文案.txt`, content.title); return;
  }
  if (mode === 'package' && imageFormat === 'original' && !LOCAL_DATA && !Capacitor.isNativePlatform()) {
    const result = await api<{ url: string; filename: string }>(`/projects/${projectId}/export`, 'POST', { kind: 'platform' in content ? 'publication' : 'asset', id: content.id, expectedRevision: 'platform' in content ? content.assetRevision : content.revision });
    download(`${API_BASE}${result.url}`, result.filename); return;
  }
  const prepared = await prepareExport(content, imageFormat);
  if (mode === 'media') { const response = await fetch(prepared.mediaData); await save(await response.blob(), exportDetails(prepared).mediaName, content.title); }
  else { const result = await contentArchive(prepared, { type: 'blob' }); await save(result.data, result.filename, content.title); }
}
