export const NURTURE_CHANNELS = ['xiaohongshu', 'douyin', 'tiktok', 'instagram'];

export function validateSceneReference(input = '') {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (typeof input !== 'string') fail('场景参考图格式无效');
  if (!input) return '';
  if (input.length > 12000000) fail('场景参考图过大，请选择较小的图片');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match || match[2].length % 4 !== 0) fail('场景参考图仅支持 PNG、JPEG 或 WebP 图片');
  const bytes = atob(match[2].slice(0, 32));
  const signature = Array.from(bytes, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const valid = match[1] === 'png' ? signature.startsWith('89504e470d0a1a0a')
    : match[1] === 'jpeg' ? signature.startsWith('ffd8ff')
      : bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP';
  if (!valid) fail('场景参考图内容与图片格式不一致');
  return input;
}

// The free template uses the user's subject and scene as content. Their writing
// prompt stays in instructions and is never pasted into the published copy.
export function nurtureTemplate(brief) {
  const { topic, scene } = brief.nurture;
  const shortScene = scene.length > 650 ? `${scene.slice(0, 650).trim()}…` : scene;
  const title = topic.length > 20 ? `${topic.slice(0, 19)}…` : topic;
  const tag = topic.replace(/[#\s]/g, '').slice(0, 40);
  return {
    title,
    body: `关于${topic}，留一点时间给日常。\n\n${shortScene}\n\n把目光放回这些具体的场景，慢慢发现值得记录的细节。你更想看到这个主题里的哪些片段？\n\n#${tag} #日常记录`,
    direction: `围绕“${topic}”制作自然、可信的日常图文。主要场景：${scene}\n标题、正文和画面要求分开；沿用用户文案要求，不编造亲身经历、产品卖点或涨粉效果。`,
  };
}
