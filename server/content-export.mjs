import JSZip from 'jszip';

export const CREATOR_URLS = { douyin: 'https://creator.douyin.com/', xiaohongshu: 'https://creator.xiaohongshu.com/' };
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function safeFilename(value, fallback = '宣传内容') {
  const clean = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '').replace(/[.\s]+$/g, '').trim();
  const short = Array.from(clean).slice(0, 48).join('');
  return !short || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(short) ? fallback : short;
}
export function exportDetails(content) {
  const platform = content.platform || content.channel;
  if (!CREATOR_URLS[platform]) fail('请选择小红书或抖音内容');
  const extension = extensions[content.mime];
  if (!extension) fail('暂不支持此素材格式，请重新制作 PNG / JPG 图片或 MP4 / WebM 视频');
  if (!content.mediaData || !content.mediaData.startsWith(`data:${content.mime};base64,`) || !/^[A-Za-z0-9+/]+={0,2}$/.test(content.mediaData.split(',')[1] || '')) fail('素材数据不完整或格式不一致，请重新制作后导出');
  if ('channel' in content && content.status !== 'ready') fail('当前内容已修改，请先重新制作再导出');
  const revision = content.assetRevision || content.revision || 1;
  const label = platform === 'douyin' ? '抖音' : '小红书';
  const stem = `${safeFilename(content.title)}-${label}-R${revision}`;
  const mediaName = `${stem}-${content.mime.startsWith('image/') ? '封面' : '视频'}.${extension}`;
  const warnings = [];
  if (extension === 'webm') warnings.push('当前视频是 WebM。若平台不接受，请用视频编辑器转为 MP4（建议 H.264 视频 / AAC 音频）；不要只修改文件后缀。');
  if (extension === 'webp') warnings.push('当前图片是 WebP。如平台不接受，可在导出面板选择 PNG 或 JPG。');
  if (Array.from(content.title || '').length > 20 && platform === 'xiaohongshu') warnings.push('标题较长，建议在平台填写前精简；具体字数限制以发布页面提示为准。原文会完整导出。');
  if (content.manualReviewRequired) warnings.push(content.manualPublishNote || '旧版任务可能已提交，请先核对平台作品，避免重复发布。');
  return { platform, label, revision, stem, mediaName, extension, filename: `${stem}-发布素材包.zip`, creatorUrl: CREATOR_URLS[platform], warnings };
}
const textFile = text => '\ufeff' + String(text).replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
export async function contentArchive(content, { type = 'nodebuffer' } = {}) {
  const info = exportDetails(content), zip = new JSZip();
  zip.file(`01-素材/${info.mediaName}`, content.mediaData.split(',')[1], { base64: true, compression: 'STORE' });
  zip.file('02-文案/标题.txt', textFile(content.title));
  zip.file('02-文案/正文.txt', textFile(content.body || ''));
  zip.file('02-文案/完整文案.txt', textFile(`${content.title}\n\n${content.body || ''}`));
  zip.file('03-发布指引.txt', textFile([
    `生长 STUDIO · ${info.label}手动发布素材包`, '',
    '导出仅生成本地文件，不会登录平台、上传素材或发布作品。',
    '1. 完整解压素材包，预览“01-素材”中的画面或视频，检查文字、声音和画面。',
    `2. 打开${info.label}创作中心：${info.creatorUrl}，登录目标账号。也可把素材传到手机，在官方 App 发布。`,
    '3. 上传图片或视频，把“02-文案”中的标题和正文分别粘贴到对应位置；话题标签请在平台核对并选择。',
    '4. 检查账号、事实、素材使用授权、可见范围和平台要求的 AI 内容标识，再亲自点击发布。',
    '5. 等待平台处理，确认作品成功发布后，复制作品链接，回工作台“发布中心 → 登记结果”。',
    '6. 在“评论与复盘”导入评论；已有接口权限的账号也可选用评论同步。', '',
    '发布时间只是工作台中的待办时间，到点不会自动上传或发布。',
    ...info.warnings.map(w => `注意：${w}`), '',
    `素材：${info.mediaName}`, `版本：R${info.revision}`, `格式：${content.mime}`, '',
    '包内文案保持原文，不自动截断。TXT 使用 UTF-8（含 BOM）和 Windows 换行。',
    '此包仅包含选中的成品与发布文案，不包含密钥、语料库、其他项目或原始生成提示词。',
  ].join('\n')));
  return { data: await zip.generateAsync({ type, compression: 'DEFLATE' }), filename: info.filename };
}
