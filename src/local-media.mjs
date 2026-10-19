const MB = 1024 * 1024;
const formats = {
  reference: { mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 8 * MB, label: 'PNG、JPG 或 WebP 图片', accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp' },
  audio: { mimes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'], maxBytes: 8 * MB, label: 'MP3、WAV、M4A、OGG 或 WebM 音频', accept: '.mp3,.wav,.m4a,.ogg,.webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm' },
  'image-asset': { mimes: ['image/png', 'image/jpeg'], maxBytes: 16 * MB, label: 'PNG 或 JPG 成品图片', accept: '.png,.jpg,.jpeg,image/png,image/jpeg' },
  'video-asset': { mimes: ['video/mp4', 'video/webm'], maxBytes: 16 * MB, label: 'MP4 或 WebM 成品视频', accept: '.mp4,.webm,video/mp4,video/webm' },
};
export function localMediaOptions(kind) {
  const options = formats[kind];
  if (!options) throw new Error('未知的素材用途');
  return options;
}
export function validateLocalMediaFile(file, kind, header) {
  const options = localMediaOptions(kind);
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('文件为空，请选择有效的素材');
  if (file.size > options.maxBytes) throw new Error(`文件过大，请选择 ${options.maxBytes / MB}MB 以内的${options.label}`);
  const aliases = { 'image/jpg': 'image/jpeg', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/mp4' };
  const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: kind === 'audio' ? 'audio/webm' : 'video/webm' };
  const rawType = String(file.type || '').toLowerCase().split(';')[0];
  const mime = aliases[rawType] || ((!rawType || rawType === 'application/octet-stream') ? extensions[String(file.name || '').toLowerCase().split('.').pop()] : rawType);
  if (!options.mimes.includes(mime)) throw new Error(`此处仅支持${options.label}${kind === 'reference' ? '；已有视频请使用“采用本地成品”' : ''}`);
  if (header) {
    const bytes = new Uint8Array(header), hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
    const valid = mime === 'image/png' ? hex.startsWith('89504e470d0a1a0a')
      : mime === 'image/jpeg' ? hex.startsWith('ffd8ff')
      : mime === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
      : mime.endsWith('/webm') ? hex.startsWith('1a45dfa3')
      : mime.endsWith('/mp4') ? ascii(4, 4) === 'ftyp'
      : mime === 'audio/wav' ? ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE'
      : mime === 'audio/ogg' ? ascii(0, 4) === 'OggS'
      : mime === 'audio/mpeg' ? ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)
      : false;
    if (!valid) throw new Error('文件内容与格式不符，请重新导出文件；修改后缀不能转换格式');
  }
  return mime;
}
