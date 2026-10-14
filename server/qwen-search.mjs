import { readBounded } from './integration-http.mjs';
import { normalizeQwenKey, qwenConnection } from './qwen-connection.mjs';
import { researchAt, researchQueries, researchText, researchURL } from './research-sources.mjs';

// Official documentation checked 2026-10-14:
// https://help.aliyun.com/zh/model-studio/web-search
// https://help.aliyun.com/zh/model-studio/qwen-plus
// Qwen-Plus web search is supported in Beijing; Singapore and other regions are
// not silently redirected. Source rows contain links, NOT verified article dates/body.
export const QWEN_SEARCH_MODEL = 'qwen-plus';
export const QWEN_SEARCH_STANDARD_CNY = 0.003;
export const QWEN_SEARCH_RESERVATION_CNY = 0.2;
export const QWEN_SEARCH_MAX_TOKENS = 256;
const report = (status, count, message) => ({ sourceId: 'web', name: 'Qwen 联网搜索', status, count, message });
const round = value => Math.round(value * 1_000_000) / 1_000_000;
const counter = value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;
// Accept the resolved settings snapshot as well as stored region/workspace
// settings. Rebuild the official host; never trust a snapshot's baseUrl.
const resolveConnection = value => qwenConnection(value == null ? undefined : { region: value.region, workspaceId: value.workspaceId || '' });

export function qwenSearchSupport(connection) {
  try {
    if (resolveConnection(connection).region === 'cn-beijing') return { supported: true, note: '复用已保存的北京地域 Qwen API Key；搜索和模型用量按百炼标准计费。' };
    return { supported: false, note: '当前地域的 qwen-plus 不支持这项联网搜索。可使用免费新闻源或火山搜索；不会将现有密钥发送到其他地域。' };
  } catch {
    return { supported: false, note: '请先在模型设置中检查 Qwen 的地域和业务空间配置。' };
  }
}

// Reservation is a conservative local estimate, NOT a provider-enforced price
// ceiling. Search inserts upstream content into the prompt; its token count is
// unknowable beforehand. Missing counters retain the reservation, never zero.
function usageEstimate(value) {
  const inputTokens = counter(value?.input_tokens), outputTokens = counter(value?.output_tokens);
  const searchCount = counter(value?.plugins?.search?.count);
  const rates = inputTokens === null ? null : inputTokens <= 128_000 ? [0.8, 2] : inputTokens <= 256_000 ? [2.4, 20] : [4.8, 48];
  const modelCostCny = rates && outputTokens !== null ? round((inputTokens * rates[0] + outputTokens * rates[1]) / 1_000_000) : null;
  const searchCostCny = searchCount === null ? null : round(searchCount * QWEN_SEARCH_STANDARD_CNY);
  const estimated = modelCostCny === null || searchCostCny === null;
  const known = round((modelCostCny || 0) + (searchCostCny || 0));
  return { model: QWEN_SEARCH_MODEL, inputTokens, outputTokens, searchCount, modelCostCny, searchCostCny, costCny: estimated ? Math.max(QWEN_SEARCH_RESERVATION_CNY, known) : known, estimated, pricingBasis: estimated ? 'reservation' : 'reported-usage-standard-rates' };
}

function failureMessage(status) {
  if ([401, 403].includes(status)) return 'Qwen 搜索鉴权或权限未通过，请在模型设置中核对北京地域、业务空间和百炼 API Key。';
  if (status === 402) return 'Qwen 搜索余额或额度不足，请查看百炼账单。';
  if (status === 429) return 'Qwen 搜索请求频率或额度受限，本次没有自动重试，请查看百炼额度后再试。';
  if ([400, 404].includes(status)) return 'Qwen 搜索参数、模型或业务空间权限未通过，请检查北京地域的 qwen-plus 模型开通情况。';
  return 'Qwen 搜索连接或返回格式异常，本次没有自动重试；已发出的请求请核对百炼账单。';
}

/** One fixed-provider request; no fetching of result URLs or model-text evidence. */
export async function searchQwen(queries, { key, connection, fetcher = fetch, at, onRequest, onUsage } = {}) {
  const collectedAt = researchAt(at), selected = researchQueries(queries), items = [];
  if (!selected.length) return { items, reports: [report('skipped', 0, '没有可用搜索词，本次未调用 Qwen 联网搜索。')] };
  const support = qwenSearchSupport(connection);
  if (!support.supported) return { items, reports: [report('skipped', 0, support.note)] };
  if (typeof key !== 'string' || !key.trim()) return { items, reports: [report('skipped', 0, '请先在模型设置中保存 Qwen API Key；此处复用该密钥，无需另填搜索密钥。')] };
  const apiKey = normalizeQwenKey(key);
  const safeQueries = selected.map(query => researchText(query, 100, [apiKey]));
  const endpoint = resolveConnection(connection).baseUrl.replace(/\/compatible-mode\/v1$/, '/api/v1/services/aigc/text-generation/generation');
  // Budget and session guards deliberately run outside the network error handler.
  if (onRequest) await onRequest({ model: QWEN_SEARCH_MODEL, queries: safeQueries, query: safeQueries.join('；'), index: 0, requestCount: 1, reservationCny: QWEN_SEARCH_RESERVATION_CNY });
  let value, status = 0, unreadable = false;
  try {
    const response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: QWEN_SEARCH_MODEL,
        input: { messages: [
          { role: 'system', content: '你是新闻搜索助手。请联网寻找相关中文新闻网页，只搜索最近七天；不要虚构来源。回答简短即可，不需要撰写宣传文案。' },
          { role: 'user', content: `采集时间：${collectedAt}。请合并检索以下主题，提供相关来源：\n${safeQueries.map((query, index) => `${index + 1}. ${query}`).join('\n')}` },
        ] },
        parameters: { enable_search: true, enable_thinking: false, max_tokens: QWEN_SEARCH_MAX_TOKENS, result_format: 'message', search_options: { forced_search: true, enable_source: true, search_strategy: 'turbo', freshness: 7 } },
      }),
    });
    status = response.status;
    value = JSON.parse((await readBounded(response, 2_000_000)).toString('utf8'));
  } catch { unreadable = true; }
  // Settle even truncated, empty, or failed responses. Callback errors must escape.
  const usage = usageEstimate(value?.usage);
  const requestFailed = unreadable || status < 200 || status >= 300 || !!value?.code;
  if (onUsage) await onUsage({ ...usage, status: usage.estimated ? 'uncertain' : requestFailed ? 'failed' : 'completed' });
  if (requestFailed) return { items, reports: [report('failed', 0, failureMessage(status))] };
  const rows = value?.output?.search_info?.search_results;
  if (!Array.isArray(rows) || !rows.length || value?.usage?.plugins?.search?.count === 0) return { items, reports: [report('failed', 0, 'Qwen 未返回可核实的搜索来源，可能未触发搜索或触发搜索限流。模型回答没有当作新闻导入，也没有自动重试。')] };
  const seen = new Set();
  for (const row of rows.slice(0, 24)) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.url === 'string' && row.url.includes(apiKey)) continue;
    const url = researchURL(row.url), title = researchText(row.title, 240, [apiKey]);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    items.push({ kind: 'web', title, url, text: '', publishedAt: '', dateBasis: 'unverified', sourceName: researchText(row.site_name, 100, [apiKey]) || new URL(url).hostname, collectedAt, metrics: null });
  }
  if (!items.length) return { items, reports: [report('failed', 0, 'Qwen 返回的来源没有通过链接检查，本次未导入网页；模型回答没有用作原文。')] };
  const truncated = value?.output?.choices?.some(choice => choice?.finish_reason === 'length');
  return { items, reports: [report('ok', items.length, `已获得 ${items.length} 条网页线索${truncated ? '（模型回答达到长度限制，仅保留实际返回的来源）' : ''}；需读取原文核实发布时间和内容，通过近七天筛选后才可进入参考库。`)] };
}
