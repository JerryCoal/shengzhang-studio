import { readBounded } from './integration-http.mjs';

// Official Custom search API and separate search-key authentication (checked 2026-10-14):
// https://docs.volcengine.com/docs/Networkedsearch/Networkedsearch-2?lang=zh
// Pricing: https://docs.volcengine.com/docs/Networkedsearch/Onlinesearchproductbilling?lang=zh
// API requests are billed separately from model tokens; the caller owns reservation/settlement.
export const WEB_SEARCH_ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search';
export const WEB_SEARCH_STANDARD_CNY = 0.02;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function researchQueries(value, limit = 3) {
  if (!Array.isArray(value) || value.length > 10 || value.some(query => typeof query !== 'string')) fail('搜索词格式无效');
  return [...new Set(value.map(query => query.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100)).filter(Boolean))].slice(0, limit);
}
export function researchAt(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('采集时间无效');
  return date.toISOString();
}
export function researchURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return '';
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) || host.startsWith('[')) return '';
    for (const name of [...url.searchParams.keys()]) if (/token|cookie|auth|secret|session|sig|key|credential|xsec|access|expires|ticket|password|passwd|csrf|^sso$|^code$|^utm_|^spm$|^source$|^from$|refer|track|^x-amz-|^x-goog-/i.test(name)) url.searchParams.delete(name);
    url.hash = '';
    return url.href;
  } catch { return ''; }
}
export function researchText(value, max = 1600, secrets = []) {
  let text = typeof value === 'string' ? value.slice(0, 100_000) : '';
  for (const secret of secrets) if (typeof secret === 'string' && secret) text = text.replaceAll(secret, '[已隐藏]');
  return text.replace(/https?:\/\/[^\s<>"']+/g, url => researchURL(url))
    .replace(/(?:xsec_token|access_token|api_key|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, '[凭证已隐藏]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
function publishTime(value) {
  // Never substitute fetch/update/index time, nor an unqualified relative date.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const millis = Date.parse(value); return Number.isFinite(millis) ? value : '';
}
const report = (status, count, message) => ({ sourceId: 'web', name: '豆包搜索 Custom版（火山）', status, count, message });

/** Fixed search service only: no fetching or proxying arbitrary result URLs, no automatic retries. */
export async function searchWeb(queries, { key, fetcher = fetch, at, onRequest } = {}) {
  const selected = researchQueries(queries), collectedAt = researchAt(at), items = [], reports = [], seen = new Set();
  if (!selected.length) return { items, reports: [report('skipped', 0, '没有可用搜索词，本次未调用联网搜索。')] };
  if (typeof key !== 'string' || !key.trim()) return { items, reports: [report('skipped', 0, '尚未配置豆包搜索 Custom版的专用 API 密钥，可在设置打开搜索控制台获取，也可改用公开新闻或 Qwen 联网。')] };
  if (key.length > 4096 || /[^\x21-\x7e]/.test(key.trim())) fail('联网搜索密钥格式无效');
  for (const [index, query] of selected.entries()) {
    // A budget/session callback failure must stop the run, never become a harmless source report.
    if (onRequest) await onRequest({ query, index });
    let response;
    try {
      // Current Custom API documents QueryControl but not TimeRange / ContentFormats.
      // Do not rely on undocumented server filtering: cleanReferences enforces the seven-day window.
      response = await fetcher(WEB_SEARCH_ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ Query: query, SearchType: 'web', Count: 8, Filter: { NeedContent: true, NeedUrl: true }, QueryControl: { QueryRewrite: false } }) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        reports.push(report('failed', 0, [401, 403].includes(response.status) ? '联网搜索密钥或服务权限未通过验证，请检查专用搜索密钥。' : response.status === 429 ? '联网搜索频率受限，本次没有自动重试。' : '联网搜索服务未完成本次查询，其他成功来源仍会保留。'));
        continue;
      }
      const value = JSON.parse((await readBounded(response, 4_000_000)).toString('utf8'));
      if (value?.ResponseMetadata?.Error || !Array.isArray(value?.Result?.WebResults)) throw new Error('invalid-response');
      let added = 0;
      for (const row of value.Result.WebResults.slice(0, 8)) {
        if (!row || typeof row !== 'object') continue;
        if (typeof row.Url === 'string' && row.Url.includes(key.trim())) continue;
        const url = researchURL(row?.Url), title = researchText(row?.Title, 240, [key.trim()]);
        if (!url || !title || seen.has(url)) continue;
        seen.add(url); added++;
        items.push({ kind: 'web', title, url, text: researchText(row.Content || row.Summary || '', 1600, [key.trim()]), publishedAt: publishTime(row.PublishTime), dateBasis: 'search-metadata', sourceName: researchText(row.SiteName, 100, [key.trim()]) || new URL(url).hostname, collectedAt, metrics: null });
      }
      reports.push(report('ok', added, `第 ${index + 1} 个搜索词已获得 ${added} 条网页候选；发布时间来自搜索服务，仍需按时间范围筛选。`));
    } catch {
      reports.push(report('failed', 0, '联网搜索连接或返回格式异常，本次没有自动重试；其他成功来源仍会保留。'));
    }
  }
  return { items, reports };
}
