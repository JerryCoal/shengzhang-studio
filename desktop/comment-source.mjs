// Pure URL handling, shared by the desktop collector, renderer and local importer.
export function commentSource(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('请粘贴有效的作品链接');
  const candidates = value.match(/https:\/\/[^\s<>"'\u3000]+/g) || [];
  for (const candidate of candidates) {
    let url; try { url = new URL(candidate.replace(/[)\]）】。，；]+$/, '')); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
    const host = url.hostname, path = url.pathname;
    if (['www.xiaohongshu.com', 'xiaohongshu.com'].includes(host)) {
      const match = path.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i);
      if (match) return { platform: 'xiaohongshu', itemId: match[1].toLowerCase(), url: url.href, canonical: `https://www.xiaohongshu.com/explore/${match[1].toLowerCase()}` };
    }
    if (['www.douyin.com', 'douyin.com', 'www.iesdouyin.com'].includes(host)) {
      const match = path.match(/^\/(?:video|share\/video|note)\/(\d{10,30})\/?$/);
      const modalIds = url.searchParams.getAll('modal_id');
      if (modalIds.length > 1 || (match && modalIds.length && modalIds[0] !== match[1])) continue;
      const itemId = match?.[1] || (['/', '/discover'].includes(path) || /^\/user\/[A-Za-z0-9_-]+\/?$/.test(path) ? url.searchParams.get('modal_id') : null);
      if (itemId && /^\d{10,30}$/.test(itemId)) return { platform: 'douyin', itemId, url: url.href, canonical: `https://www.douyin.com/video/${itemId}` };
    }
    if (host === 'v.douyin.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(path)) return { platform: 'douyin', itemId: null, url: url.href, canonical: null };
    if (host === 'xhslink.com' && /^\/(?:[A-Za-z]\/)?[A-Za-z0-9_-]+\/?$/.test(path)) return { platform: 'xiaohongshu', itemId: null, url: url.href, canonical: null };
  }
  throw new Error('请使用抖音或小红书的作品详情 / 分享链接，不是主页或搜索页');
}
export function sameCommentWork(expected, actual) {
  return expected.platform === actual.platform && !!actual.itemId && (!expected.itemId || expected.itemId === actual.itemId);
}
