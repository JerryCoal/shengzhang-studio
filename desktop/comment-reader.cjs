// Reads rendered comment nodes only: no cookies, storage, page state or private API requests.
// This function is stringified for executeJavaScriptInIsolatedWorld and also tested with fixtures.
function readCommentPage(platform, selectedOnly = false) {
  const plain = node => (node?.innerText || '').trim();
  const count = value => /^\d{1,9}$/.test(value) ? Number(value) : null;
  const textWithEmoji = node => {
    if (!node) return '';
    // Preserve inline platform emoji, without treating photo alt as a comment.
    if (!node.querySelector('img')) return plain(node);
    const walk = el => {
      if (el.nodeType === 3) return el.textContent || '';
      if (el.nodeType !== 1 || el.matches('[hidden],[aria-hidden="true"],script,style')) return '';
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return '';
      if (el.tagName === 'BR') return '\n';
      if (el.tagName === 'IMG') { const alt = el.getAttribute('alt') || ''; return /^\[[^\]\r\n]{1,40}\]$/.test(alt) ? alt : ''; }
      const content = [...el.childNodes].map(walk).join('');
      return ['block','flex','list-item'].includes(style.display) ? content + '\n' : content;
    };
    return walk(node).trim();
  };
  const result = { rows: [], url: location.href, title: document.title.slice(0, 240), limited: true, mode: selectedOnly ? 'selection' : 'page', skipped: 0 };
  if (selectedOnly) {
    const text = String(window.getSelection() || '').trim();
    if (text.length > 120000) return { ...result, error: '选中内容过长，请分批读取' };
    const lines = text.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
    if (lines.length > 1000) return { ...result, error: '选中文字超过 1,000 行，请分批读取' };
    result.rows = lines.filter(text => { if(text.length>4000) { result.skipped++;return false; } return true; }).map(text => ({ text, likes: null, timeLabel: '', isReply: false }));
    return result;
  }
  if (!['xiaohongshu','douyin'].includes(platform)) return { ...result, error: '暂不支持这个平台' };
  if (platform === 'douyin' && !/^\/video\/\d+\/?$/.test(location.pathname)) return { ...result, error: '请在“评论采集”菜单选择“打开独立作品页”，再读取；也可以选中文字后备用读取。' };
  const selector = platform === 'douyin' ? '[data-e2e="comment-item"]' : '.comment-item';
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length && !node.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden');
  result.skipped = Math.max(0, nodes.length - 1000);
  for (const node of nodes.slice(0, 1000)) {
    const own = query => [...node.querySelectorAll(query)].find(e => e.closest(selector) === node);
    const isDouyin = platform === 'douyin';
    const content = own(isDouyin ? '.FduGc_lz > .Sh1Da424' : '.content'), text = textWithEmoji(content);
    if (!text || text.length > 4000) { result.skipped++; continue; }
    const platformCommentId = isDouyin ? /^tooltip_(\d{10,30})$/.exec(own('[data-e2e="video-comment-more"] [id]')?.id || '')?.[1] : /^comment-([a-f0-9]{24})$/i.exec(node.id)?.[1];
    // Labels lack a year/timezone. Keep their visible wording rather than invent a timestamp.
    const timeLabel = plain(own(isDouyin ? '.VAQA49VP > span' : '.info .date > span:not(.location)')).split('·')[0].trim().slice(0, 100);
    const likes = count(plain(own(isDouyin ? '.comment-item-stats-container p:first-child > span' : '.info .like .count')));
    result.rows.push({ text, ...(platformCommentId ? { platformCommentId } : {}), timeLabel, likes, isReply: isDouyin ? !!node.closest('.replyContainer') : node.classList.contains('comment-item-sub') });
  }
  return result;
}
module.exports = { readCommentPage };
