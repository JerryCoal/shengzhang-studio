import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { isPublicAddress } from './integration-http.mjs';
import { plainText } from './news-crawler.mjs';
import { researchURL, researchText, researchAt } from './research-sources.mjs';

const MAX_PAGES = 6, MAX_HTML = 1_200_000, MAX_ROBOTS = 100_000;
const REQUEST_MS = 8000, DNS_MS = 4000, AGENT = 'ShengzhangResearch';
const PAGE_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle', 'TechArticle', 'AnalysisNewsArticle', 'WebPage']);
const forbidden = () => { throw Error('公开网页暂不可核验'); };
const abortError = () => Error('公开网页读取超时');

function targetURL(value) {
  const safe = researchURL(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hostname.endsWith('.')) return null;
    return url;
  } catch { return null; }
}
function publicAddress(value) {
  const family = isIP(value?.address || '');
  if (!family || family !== value.family || !isPublicAddress(value.address)) return false;
  // The shared checker admits global-unicast prefixes; these are reserved or transition ranges.
  if (family === 6) {
    const [first, second] = value.address.split(':').map(part => parseInt(part || '0', 16));
    if (first === 0x2002 || first === 0x3fff || first === 0x2001 && (second < 0x200 || second === 0xdb8)) return false;
  }
  return family !== 4 || !value.address.startsWith('192.88.99.');
}
function withSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
async function resolvePublic(host, resolver) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), DNS_MS);
  try {
    const rows = await withSignal(Promise.resolve().then(() => resolver(host, { all: true })), controller.signal);
    if (!Array.isArray(rows) || !rows.length || rows.length > 32 || !rows.every(publicAddress)) forbidden();
    // Some Windows networks resolve AAAA first despite an unreliable IPv6 route.
    // Prefer a checked IPv4 address without another DNS lookup or a retry to a new host.
    return rows.map(({ address, family }) => ({ address, family })).sort((a, b) => a.family - b.family);
  } finally { clearTimeout(timer); }
}
function pinnedLookup(host, address) {
  return (requested, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (requested !== host) { callback(Error('来源主机已变化')); return; }
    if (options?.all) callback(null, [{ ...address }]);
    else callback(null, address.address, address.family);
  };
}

// A fresh direct HTTPS connection uses the checked address, original host/SNI and TLS verification.
// It never uses fetch's proxy configuration, a cookie jar, netrc or environment credentials.
function pinnedFetch(url, init) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', agent: false, autoSelectFamily: false,
      lookup: init.lookup, headers: init.headers, signal: init.signal }, res => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers }));
      } catch (error) { res.destroy(); reject(error); }
    });
    req.once('error', reject); req.end();
  });
}
async function readBody(response, limit, signal) {
  if (Number(response.headers.get('content-length')) > limit) forbidden();
  if (!response.body?.getReader) forbidden();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await withSignal(reader.read(), signal);
      if (done) break;
      size += value.byteLength; if (size > limit) forbidden(); chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function getText(url, address, transport, robots = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_MS);
  let response;
  try {
    response = await withSignal(Promise.resolve().then(() => transport(url.href, { method: 'GET', redirect: 'error', credentials: 'omit',
      signal: controller.signal, lookup: pinnedLookup(url.hostname, address),
      headers: { 'User-Agent': `${AGENT}/1.0 (public research source reader)`, Accept: robots ? 'text/plain' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' } })), controller.signal);
    if (response.redirected || response.status >= 300 && response.status < 400) forbidden();
    if (robots && [404, 410].includes(response.status)) return '';
    if (!response.ok) forbidden();
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!robots && !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/.test(type)) forbidden();
    const encoding = (response.headers.get('content-encoding') || 'identity').toLowerCase();
    if (encoding !== 'identity') forbidden();
    const bytes = await readBody(response, robots ? MAX_ROBOTS : MAX_HTML, controller.signal);
    const charset = /charset\s*=\s*["']?(gb2312|gbk|gb18030)/i.test(type) ? 'gb18030' : 'utf-8';
    const text = new TextDecoder(charset).decode(bytes);
    if (robots && /<(?:html|!doctype)/i.test(text)) forbidden();
    return text;
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    controller.abort();
  }
}

// A bounded wildcard matcher avoids turning remote robots rules into regular expressions.
function matchesRule(path, pattern) {
  const end = pattern.endsWith('$');
  if (end) pattern = pattern.slice(0, -1); else pattern += '*';
  let i = 0, j = 0, star = -1, checkpoint = 0;
  while (i < path.length) {
    if (pattern[j] === path[i]) { i++; j++; }
    else if (pattern[j] === '*') { star = j++; checkpoint = i; }
    else if (star >= 0) { j = star + 1; i = ++checkpoint; }
    else return false;
  }
  while (pattern[j] === '*') j++;
  return j === pattern.length;
}
function robotsPermits(text, url) {
  const groups = []; let group, hasRules = false;
  const lines = text.split(/\r?\n/); if (lines.length > 3000) forbidden();
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim(), colon = line.indexOf(':'); if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (name === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(name)) {
      if (value.length > 1024) forbidden();
      hasRules = true; if (value) group.rules.push({ path: value, allow: name === 'allow' });
    }
  }
  const scores = groups.map(g => Math.max(0, ...g.agents.filter(a => a && a !== '*' && AGENT.toLowerCase().includes(a)).map(a => a.length)));
  const mostSpecific = Math.max(0, ...scores);
  const selected = mostSpecific ? groups.filter((_g, index) => scores[index] === mostSpecific) : groups.filter(g => g.agents.includes('*'));
  const normalize = value => value.replace(/%[a-f0-9]{2}/gi, encoded => { const decoded = String.fromCharCode(parseInt(encoded.slice(1), 16)); return /[A-Za-z0-9._~-]/.test(decoded) ? decoded : encoded.toUpperCase(); });
  const path = normalize(url.pathname + url.search); let best = null;
  for (const entry of selected) for (const rule of entry.rules) if (matchesRule(path, normalize(rule.path))) {
    const size = rule.path.replace(/\*/g, '').length;
    if (!best || size > best.size || size === best.size && rule.allow) best = { ...rule, size };
  }
  return !best || best.allow;
}
function attributes(tag) {
  const values = Object.create(null);
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) values[match[1].toLowerCase()] = plainText(match[2] ?? match[3] ?? match[4] ?? '');
  return values;
}
function exactDate(value, at) {
  if (typeof value !== 'string' || value.length > 64) return '';
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i);
  if (!m) return '';
  const [, y, mo, d, h, mi, s = '0', zone] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > new Date(Date.UTC(+y, +mo, 0)).getUTCDate() || +h > 23 || +mi > 59 || +s > 59) return '';
  if (zone.toUpperCase() !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return '';
  const time = Date.parse(value.trim());
  return Number.isFinite(time) && time <= at ? new Date(time).toISOString() : '';
}
function comparable(value, base) {
  try { const url = targetURL(new URL(value, base).href); if (!url) return ''; url.hash = ''; return url.href.replace(/\/$/, ''); } catch { return ''; }
}
function articleContainer(html) {
  const known = new Set(['articlebody', 'post_content', 'article-content', 'article_content', 'post-content', 'left_zw']);
  const candidates = [...html.matchAll(/<(article|main|div|section)\b[^>]{0,8192}>/gi)];
  const explicit = candidates.find(match => {
    const attrs = attributes(match[0]);
    return (attrs.itemprop || '').toLowerCase().split(/\s+/).includes('articlebody') || `${attrs.id || ''} ${attrs.class || ''}`.toLowerCase().split(/\s+/).some(name => known.has(name));
  });
  const selected = explicit || candidates.find(match => /^(article|main)$/i.test(match[1]));
  if (!selected) return { body: '', explicit: false };
  const tag = selected[1], start = selected.index + selected[0].length, nested = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  nested.lastIndex = start; let depth = 1, token;
  while ((token = nested.exec(html))) {
    if (token[0].startsWith('</')) depth--; else if (!token[0].endsWith('/>')) depth++;
    if (!depth) return { body: html.slice(start, token.index), explicit: !!explicit };
  }
  return { body: '', explicit: false };
}
function pageMetadata(html, url, at) {
  const dates = [], structured = []; let scripts = 0, jsonBytes = 0, nodes = 0;
  const uncommented = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const metadataHTML = uncommented.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  for (const match of metadataHTML.matchAll(/<meta\b[^>]{0,8192}>/gi)) {
    const attrs = attributes(match[0]), key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (['article:published_time', 'datepublished'].includes(key)) dates.push(exactDate(attrs.content, at));
  }
  for (const match of metadataHTML.matchAll(/<time\b[^>]{0,8192}>/gi)) {
    const attrs = attributes(match[0]); if (attrs.itemprop?.toLowerCase() === 'datepublished') dates.push(exactDate(attrs.datetime, at));
  }
  for (const match of uncommented.matchAll(/<script\b([^>]{0,8192})>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    if (++scripts > 8 || match[2].length > 64_000 || (jsonBytes += match[2].length) > 128_000) continue;
    let value; try { value = JSON.parse(match[2]); } catch { continue; }
    const stack = [{ value, depth: 0 }];
    while (stack.length && nodes++ < 200) {
      const { value: node, depth } = stack.pop(); if (!node || typeof node !== 'object' || depth > 8) continue;
      if (Array.isArray(node)) { for (const item of node.slice(0, 40)) stack.push({ value: item, depth: depth + 1 }); continue; }
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (types.some(type => PAGE_TYPES.has(typeof type === 'string' ? type.replace(/^https?:\/\/schema\.org\//, '') : ''))) {
        const identity = node.url || node.mainEntityOfPage?.['@id'] || (typeof node.mainEntityOfPage === 'string' ? node.mainEntityOfPage : '') || node['@id'];
        if (!identity || typeof identity === 'string' && comparable(identity, url) === comparable(url, url)) structured.push({ date: exactDate(node.datePublished, at), identity: !!identity, body: typeof node.articleBody === 'string' ? plainText(node.articleBody) : '' });
      }
      // Related articles, comments and arbitrary nested objects are not publication evidence for this page.
      for (const key of ['@graph', 'mainEntity']) if (node[key]) stack.push({ value: node[key], depth: depth + 1 });
    }
  }
  const unscoped = structured.filter(item => !item.identity);
  const current = structured.filter(item => item.identity || unscoped.length === 1);
  dates.push(...current.map(item => item.date));
  const valid = [...new Set(dates.filter(Boolean))];
  const publishedAt = valid.length === 1 ? valid[0] : '';
  const withoutNoise = html.replace(/<!--([\s\S]*?)-->/g, ' ').replace(/<(script|style|noscript|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const container = articleContainer(withoutNoise);
  const paragraphs = [...container.body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].slice(0, 100).map(m => plainText(m[1])).filter(text => text.length >= 20);
  const text = researchText([...new Set(paragraphs)].join(' ') || (container.explicit ? plainText(container.body) : '') || current.find(item => item.body)?.body || '', 1600);
  return { text, publishedAt, dateBasis: publishedAt ? 'page-published-metadata' : '' };
}

/** Reads at most six unique public pages. Failed/undated entries remain source clues with empty dates. */
export async function enrichResearchPages(items, { fetcher, resolver = lookup, at, assertActive } = {}) {
  if (!Array.isArray(items)) throw Error('网页来源格式无效');
  const collectedAt = researchAt(at), clock = Date.parse(collectedAt);
  let interrupted = false, interruption;
  async function active() {
    if (interrupted) throw interruption;
    try { if (assertActive) await assertActive(); }
    catch (error) { interrupted = true; interruption = error; throw error; }
    if (interrupted) throw interruption;
  }
  const transport = async (url, init) => { await active(); return (fetcher || pinnedFetch)(url, init); };
  const output = items.slice(0, 80).map(item => ({ ...item, title: researchText(item?.title, 240), url: researchURL(item?.url), text: '', publishedAt: '', dateBasis: '', collectedAt }));
  const dns = new Map(), robots = new Map(), seen = new Set(), work = [];
  let failed = 0, read = 0, verified = 0, skipped = 0;
  for (const item of output) {
    const url = targetURL(item.url);
    if (!url || seen.has(url.href) || work.length >= MAX_PAGES) { skipped++; continue; }
    seen.add(url.href); work.push({ item, url });
  }
  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const { item, url } = work[cursor++];
      try {
        await active();
        if (!dns.has(url.hostname)) dns.set(url.hostname, resolvePublic(url.hostname, resolver));
        const addresses = await dns.get(url.hostname), address = addresses[0];
        await active();
        if (!robots.has(url.origin)) robots.set(url.origin, getText(new URL('/robots.txt', url), address, transport, true));
        if (!robotsPermits(await robots.get(url.origin), url)) forbidden();
        const html = await getText(url, address, transport);
        await active();
        read++; Object.assign(item, pageMetadata(html, url.href, clock));
        if (item.text && item.publishedAt) verified++;
        await active();
      } catch (error) { if (interrupted) throw interruption; failed++; }
    }
  }
  await active();
  await Promise.allSettled([worker(), worker()]);
  await active();
  return { items: output, reports: [{ sourceId: 'web', name: '公开网页原文核验', status: verified ? 'ok' : failed && !read ? 'failed' : 'skipped', count: verified,
    message: `最多读取 ${MAX_PAGES} 个公开网页；已读取 ${read} 个，${verified} 个同时取得原文摘要和明确发布时间，${failed} 个未能读取，${skipped} 个未读取或重复。缺少日期的结果仅保留为线索，不进入近七天证据。` }] };
}
