// Pure URL handling, shared by the desktop collector, renderer and local importer.
export function commentSource(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('请粘贴有效的作品链接');
  const candidates = value.match(/https:\/\/[^\s<>"'\u3000]+/g) || [];
  for (const candidate of candidates) {
    let url; try { url = new URL(candidate.replace(/[)\]）】。，；]+$/, '')); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
    const host = url.hostname, path = url.pathname;
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
      const ids = url.searchParams.getAll('v');
      if (ids.length > 1) continue;
      const itemId = host === 'youtu.be' ? path.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] : path === '/watch' ? ids[0] : path.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
      if (itemId && /^[A-Za-z0-9_-]{11}$/.test(itemId)) return { platform: 'youtube', itemId, url: url.href, canonical: `https://www.youtube.com/watch?v=${itemId}` };
    }
    if (['www.tiktok.com', 'tiktok.com'].includes(host)) {
      const match = path.match(/^\/@([A-Za-z0-9_.]{1,40})\/(?:video|photo)\/(\d{10,30})\/?$/);
      if (match) return { platform: 'tiktok', itemId: match[2], url: url.href, canonical: `https://www.tiktok.com/@${match[1]}/${path.includes('/photo/') ? 'photo' : 'video'}/${match[2]}` };
    }
    if (['www.instagram.com', 'instagram.com'].includes(host)) {
      const match = path.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/);
      if (match) return { platform: 'instagram', itemId: match[1], url: url.href, canonical: `https://www.instagram.com/p/${match[1]}/` };
    }
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
  throw new Error('请使用对应平台的完整作品详情链接，不是主页或搜索页；TikTok 短链接请先在浏览器打开后复制完整地址');
}
export function sameCommentWork(expected, actual) {
  return expected.platform === actual.platform && !!actual.itemId && (!expected.itemId || expected.itemId === actual.itemId);
}
