// One bounded UI step. It never reads cookies or page-private state, or calls a private API.
// Kept self-contained because Electron executes it in an isolated world on the official page.
function commentPageStep(platform, options = {}) {
  const url = new URL(location.href), result = { url: location.href, action: 'none', blocked: '', atEnd: false };
  const id = platform === 'douyin' ? /^\/video\/(\d+)\/?$/.exec(url.pathname)?.[1] : /^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i.exec(url.pathname)?.[1];
  const hostOK = platform === 'douyin' ? ['douyin.com','www.douyin.com'].includes(url.hostname) : ['xiaohongshu.com','www.xiaohongshu.com'].includes(url.hostname);
  if (!hostOK || url.protocol !== 'https:' || !id || id !== options.itemId) return { ...result, blocked: '页面不是选定作品的独立详情页，请回到原作品再开始。' };
  const selector = platform === 'douyin' ? '[data-e2e="comment-item"]' : '.comment-item';
  const visible = el => !!el && el.getClientRects().length > 0 && !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden';
  const onScreen = el => { if(!visible(el))return false;const r=el.getBoundingClientRect();return r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth; };
  const content = el => (el.innerText || '').trim();
  // Restrict detection to actual login/challenge UI, not readers mentioning these words in a comment.
  for (const el of document.querySelectorAll('[class*="captcha"], [id*="captcha"], [role="dialog"], .login-container, .login-mask, .login-modal, .douyin_login_comp_flat_panel')) {
    if (!visible(el) || el.closest(selector)) continue;
    const text = content(el).slice(0, 2000);
    if (/安全验证|拖动滑块|完成验证|访问过于频繁|操作过于频繁|访问受限/.test(text)) return { ...result, blocked: '页面要求验证或限制访问，已暂停。请自行完成页面提示后再继续。' };
    if (/扫码登录|手机号登录|验证码登录|密码登录|登录后推荐/.test(text)) return { ...result, blocked: '请先在下方官方页面完成登录，或关闭可关闭的登录提示，再点击开始。' };
  }
  const comments = [...document.querySelectorAll(selector)].filter(visible);
  if (!comments.length) return { ...result, blocked: '还没有可读取的评论。请等待页面加载，或在作品页打开评论区，再点击开始。' };
  const first = comments[0];
  const scope = first.closest('.comments-container, .comment-list, [data-e2e="comment-list"]') || first.parentElement;
  const expandPattern = /^(?:展开|查看|加载)\s*(?:(?:全部|更多|剩余)\s*)?(?:\d+\s*条?\s*)?(?:回复|评论)(?:\s*\(\d+\))?$/;
  if (options.advance && options.includeReplies) {
    // Douyin's reply controls can be plain spans with changing class names.
    // Exact labels inside the verified comment list, excluding bodies/authors, remain required.
    const candidates = scope ? [...scope.querySelectorAll(platform === 'douyin' ? 'button, [role="button"], div, span' : '.show-more, [class*="expand"], [class*="more-reply"], button, [role="button"]')] : [];
    const bodySelector = '.content, .Sh1Da424, .comment-item-info-wrap, .author-wrapper';
    const target = candidates.find(el => visible(el) && expandPattern.test(content(el)) && !el.closest(bodySelector) && !el.querySelector(bodySelector) && (!el.href || el.getAttribute('href') === '#'));
    if (target) { target.scrollIntoView({ block:'nearest', behavior:'instant' }); target.click(); return { ...result, action: 'expand' }; }
  }
  // Walk from a known comment to its actual scroll container; never scroll a recommendation feed.
  let scroller = first.parentElement;
  while (scroller && !(/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight + 2)) scroller = scroller.parentElement;
  scroller ||= document.scrollingElement;
  const scanRoot = scope || scroller;
  const messages = scanRoot ? [...scanRoot.querySelectorAll('div, span, p')].filter(el => el.children.length === 0 && onScreen(el) && !el.closest(selector)) : [];
  if (messages.some(el => /^(?:登录查看全部评论内容|登录后查看(?:全部|更多)评论)$/.test(content(el)))) return { ...result, blocked: '更多评论需要登录，已暂停。当前已采集内容保留，可返回预览或登录后继续。' };
  result.atEnd = messages.some(el => /^(?:暂时没有更多评论|没有更多评论了?|没有更多了|已显示全部评论|到底了|—+\s*THE END\s*—+)$/i.test(content(el)));
  if (options.advance && !result.atEnd && scroller) {
    if (first.getBoundingClientRect().top > innerHeight && !comments.some(onScreen)) { first.scrollIntoView({block:'start',behavior:'instant'});return {...result,action:'scroll'}; }
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(220, Math.round(scroller.clientHeight * .8)));
    result.action = Math.abs(scroller.scrollTop - before) > 1 ? 'scroll' : 'wait';
  }
  return result;
}
module.exports = { commentPageStep };
