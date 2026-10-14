import { z } from 'zod';
import { COMMON_WORDS } from './trends.mjs';

export const RESEARCH_WEEK = 7 * 86400000;
export const RESEARCH_MAX_REFERENCES = 80;
export const RESEARCH_MAX_TEXT = 1200;
const metricNames = ['likes', 'comments', 'favorites', 'shares'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const norm = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
const cut = (value, length) => Array.from(value).slice(0, length).join('');
const cutUnits = (value, length) => value.slice(0, length).replace(/[\uD800-\uDBFF]$/u, '');
const list = value => Array.isArray(value) ? value.filter(term => typeof term === 'string' && term.trim()).map(term => term.trim()).slice(0, 200) : [];
const blocked = (text, terms) => terms.some(term => norm(text).includes(norm(term)));
const dispute = /版权纠纷|版权争议|著作权纠纷|著作权争议|商标纠纷|商标争议|侵权纠纷|侵权诉讼|涉嫌侵权|被诉侵权|被指抄袭|抄袭争议|未经授权|盗版|copyright\s*(?:dispute|lawsuit|infringement)|trademark\s*(?:dispute|lawsuit)|plagiarism\s*(?:claim|dispute)/iu;
const disputed = text => dispute.test(norm(text)) || dispute.test(norm(text).replace(/\s+/gu, ''));
const entity = /《[^》]+》|电影|影视|动漫|动画|角色|明星|艺人|演员|歌手|演唱会|游戏|品牌|联名|商标|IP授权|代言|公司|厂商|迪士尼|漫威|宝可梦|三丽鸥|泡泡玛特|Labubu|原神|周杰伦|ChatGPT|OpenAI|DeepSeek|iPhone|华为|小米|腾讯|阿里云|特斯拉|星巴克|瑞幸/iu;
const restrictedBasis = /unknown|未知|updated|更新时间|更新日期|crawl|collect|采集|抓取|搜索(?:时间|过滤|筛选)|search[-_ ]?filter|推算|估算|解码/iu;
const limitation = '仅反映本次采集样本，不代表全网排名；互动量不能证明曝光、成交、转化或因果，应用建议需验证。';
const discoverySchema = z.object({
  timeRange: z.enum(['week', 'month', 'all']), sortBy: z.enum(['general', 'likes', 'favorites', 'comments']), noteType: z.enum(['all', 'image', 'video']),
}).strict();
function discoveryOf(value) {
  if (value === undefined) return undefined;
  const parsed = discoverySchema.safeParse(value);
  if (!parsed.success) fail('小红书内容发现筛选无效');
  return parsed.data;
}

function clock(at = Date.now()) {
  const value = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;
  if (!Number.isFinite(value)) fail('研究时间无效');
  return value;
}

function sourceDate(value) {
  if (typeof value === 'number' || typeof value === 'string' && /^\d{10}(?:\d{3})?$/.test(value)) {
    const numeric = Number(value), result = numeric < 1e12 ? numeric * 1000 : numeric;
    return Number.isSafeInteger(result) && Number.isFinite(new Date(result).getTime()) ? { time: result } : { error: 'missingDate' };
  }
  if (typeof value !== 'string' || !value.trim()) return { error: 'missingDate' };
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i);
  const rfc = text.match(/^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|[+-]\d{4})$/i);
  if (!iso && !rfc) return { error: 'uncertainDate' };
  const year = Number(iso ? iso[1] : rfc[3]);
  const month = iso ? Number(iso[2]) : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(rfc[2].toLowerCase()) + 1;
  const day = Number(iso ? iso[3] : rfc[1]), hour = Number((iso || rfc)[4]), minute = Number((iso || rfc)[5]), second = Number((iso || rfc)[6] || 0);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return { error: 'missingDate' };
  const time = Date.parse(text);
  return Number.isFinite(time) ? { time } : { error: 'missingDate' };
}

function unescapeHTML(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (whole, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] || whole;
    const number = parseInt(code.slice(code[1].toLowerCase() === 'x' ? 2 : 1), code[1].toLowerCase() === 'x' ? 16 : 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : ' ';
  });
}

function plain(value) {
  let text = typeof value === 'string' ? value : '';
  text = unescapeHTML(unescapeHTML(text)).replace(/<!--[\s\S]*?-->/gu, ' ');
  const containers = 'script|style|noscript|iframe|svg|nav|header|footer|aside|form|button';
  text = text.replace(new RegExp(`<(${containers})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'giu'), ' ')
    .replace(new RegExp(`<(?:${containers})\\b[^>]*>[\\s\\S]*$`, 'giu'), ' ')
    .replace(/<\/?(?:p|div|br|li|section|article|h[1-6]|tr)\b[^>]*>/giu, '\n')
    .replace(/<[^>]*>/gu, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  return text.split(/\r?\n/u).map(line => line.replace(/[\t\u00a0 ]+/gu, ' ').trim())
    .filter(line => line && !/^(?:首页|登录|注册|返回顶部|上一页|下一页|上一篇|下一篇|联系我们|关于我们|隐私政策|用户协议|版权所有|网站导航|打开APP|下载APP)$/iu.test(line)).join('\n').trim();
}

function publicURL(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 4096 || /[\u0000-\u0020]/u.test(raw)) return null;
    const url = new URL(raw), host = url.hostname.toLowerCase().replace(/\.$/u, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
    // Reject IP literals (including URL-normalized numeric/hex IPv4) and local DNS names.
    // Public-host DNS resolution and redirect validation remain the collector's responsibility.
    if (/^[\d.]+$/u.test(host) || host.includes(':') || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|private|test|invalid|example|onion|arpa)$/iu.test(host)) return null;
    if (host.split('.').some(label => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu.test(label))) return null;
    url.hostname = host; url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|igshid|xsec_.+|source|from|spm|share_.+)$/iu.test(key) || /token|auth|session|cookie|password|secret|signature|credential|(?:^|_)api_?key|(?:^|_)access_?key/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
    return url;
  } catch { return null; }
}

function canonicalURL(item) {
  if (item.kind !== 'xiaohongshu') return publicURL(item.url)?.href || null;
  const external = typeof item.externalId === 'string' && /^[\da-f]{24}$/iu.test(item.externalId) ? item.externalId.toLowerCase() : null;
  const url = item.url ? publicURL(item.url) : null;
  if (item.url && (!url || !['xiaohongshu.com', 'www.xiaohongshu.com'].includes(url.hostname))) return null;
  const pathId = url?.pathname.match(/^\/(?:explore|discovery\/item)\/([\da-f]{24})(?:\/|$)/iu)?.[1]?.toLowerCase();
  if (external && pathId && external !== pathId) return null;
  const id = pathId || external;
  return id ? `https://www.xiaohongshu.com/explore/${id}` : null;
}

// Stable content IDs, not authentication tokens; works in both Node and the browser.
function stableId(text) {
  let hash = 0xcbf29ce484222325n;
  for (const point of text) hash = BigInt.asUintN(64, (hash ^ BigInt(point.codePointAt(0))) * 0x100000001b3n);
  return `ref-${hash.toString(16).padStart(16, '0')}`;
}

function metric(input) {
  if (input && typeof input === 'object') input = typeof input.raw === 'string' && input.raw.trim() ? input.raw : input.value;
  const raw = input == null ? '' : cut(String(input).trim(), 80), unknown = { value: null, raw, approximate: false };
  if (typeof input === 'number') return Number.isSafeInteger(input) && input >= 0 ? { value: input, raw, approximate: false } : unknown;
  const match = raw.normalize('NFKC').replace(/[,，\s]/gu, '').match(/^(\d+(?:\.\d+)?)(万|亿|w|k|m|b)?(\+)?$/iu);
  if (!match) return unknown;
  const unit = (match[2] || '').toLowerCase(), factor = { 万: 1e4, 亿: 1e8, w: 1e4, k: 1e3, m: 1e6, b: 1e9 }[unit] || 1;
  const value = Number(match[1]) * factor;
  return Number.isSafeInteger(value) && value >= 0 && value <= 1e13 ? { value, raw, approximate: !!unit || !!match[3] } : unknown;
}

function riskFor(text, dateBasis = '') {
  const review = entity.test(text);
  const dateNote = dateBasis === 'search-metadata' ? '发布时间来自搜索服务元数据，未逐页核实。' : '';
  return { risk: review ? 'review' : 'unverified', riskReason: dateNote + (review ? '包含人物、品牌、作品或商业实体线索，需逐项确认名称使用、授权与关联表达。' : '未发现明显实体线索，但未完成版权、商标或姓名权核查；来源内容仍需核实。') };
}

export function cleanReferences(raw, { keywords = [], blockTerms = [], genericTerms = [], at = Date.now(), discovery } = {}) {
  const now = clock(at), discoveryOptions = discoveryOf(discovery), terms = list(blockTerms), references = [], urls = new Set(), titles = new Set();
  const excluded = Object.fromEntries(['invalid', 'unsafeUrl', 'missingDate', 'uncertainDate', 'future', 'expired', 'noteType', 'emptyContent', 'dispute', 'blocked', 'duplicate', 'limit'].map(key => [key, 0]));
  if (!Array.isArray(raw)) fail('采集结果必须是列表');
  // Synonyms need not literally contain keywords; relevance is evaluated by retrieval/analysis.
  void keywords; void genericTerms;
  for (const item of raw.slice(0, 2000)) {
    if (!item || !['web', 'xiaohongshu', 'rss'].includes(item.kind) || typeof item.title !== 'string' || typeof item.text !== 'string' || item.title.length > 3000 || item.text.length > 200000) { excluded.invalid++; continue; }
    const url = canonicalURL(item); if (!url) { excluded.unsafeUrl++; continue; }
    const dateBasis = cut(plain(item.dateBasis || '来源提供的发布时间，未独立复核'), 120);
    if (restrictedBasis.test(dateBasis)) { excluded.uncertainDate++; continue; }
    const date = sourceDate(item.publishedAt); if (date.error) { excluded[date.error]++; continue; }
    if (date.time > now) { excluded.future++; continue; }
    const window = item.kind === 'xiaohongshu' && discoveryOptions ? ({ week: RESEARCH_WEEK, month: 30 * 86400000, all: Infinity })[discoveryOptions.timeRange] : RESEARCH_WEEK;
    if (date.time < now - window) { excluded.expired++; continue; }
    const noteType = item.kind === 'xiaohongshu' ? (['image', 'video'].includes(item.noteType) ? item.noteType : 'unknown') : undefined;
    if (item.kind === 'xiaohongshu' && discoveryOptions && discoveryOptions.noteType !== 'all' && noteType !== discoveryOptions.noteType) { excluded.noteType++; continue; }
    const title = plain(item.title), text = plain(item.text), all = `${title}\n${text}`;
    if (!title || !text) { excluded.emptyContent++; continue; }
    if (disputed(all)) { excluded.dispute++; continue; }
    if (blocked(all, terms)) { excluded.blocked++; continue; }
    const titleKey = norm(title).replace(/[\p{P}\p{S}\s]/gu, '');
    if (urls.has(url) || titles.has(titleKey)) { excluded.duplicate++; continue; }
    urls.add(url); titles.add(titleKey);
    const collected = sourceDate(item.collectedAt), collectedAt = new Date(!collected.error && collected.time <= now && collected.time >= date.time ? collected.time : now).toISOString();
    references.push({ id: stableId(url), kind: item.kind, ...(noteType ? { noteType } : {}), title: cut(title, 180), url, text: cut(text, RESEARCH_MAX_TEXT), publishedAt: new Date(date.time).toISOString(), collectedAt, dateBasis,
      sourceName: cut(plain(item.sourceName) || new URL(url).hostname, 160), metrics: Object.fromEntries(metricNames.map(name => [name, metric(item.metrics?.[name])])), ...riskFor(all, dateBasis) });
  }
  references.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  excluded.limit = Math.max(0, raw.length - 2000) + Math.max(0, references.length - RESEARCH_MAX_REFERENCES);
  return { references: references.slice(0, RESEARCH_MAX_REFERENCES), excluded };
}

// A local ordering of the returned sample, never a platform-wide popularity score.
// Missing counters stay null. A partial visible sum is explicitly paired with its known fields.
export function rankXhsReferences(references, { keywords = [], sortBy = 'general' } = {}) {
  if (!['general', 'likes', 'favorites', 'comments'].includes(sortBy)) fail('小红书样本排序方式无效');
  if (!Array.isArray(references)) fail('小红书样本必须是列表');
  const terms = [...new Map(list(keywords).map(term => [norm(term), cut(term, 100)])).values()].slice(0, 30);
  const compareKnown = (a, b) => a === null ? b === null ? 0 : 1 : b === null ? -1 : b - a;
  const ranked = references.filter(reference => reference?.kind === 'xiaohongshu').map(reference => {
    const metrics = Object.fromEntries(metricNames.map(name => [name, metric(reference.metrics?.[name])])), text = norm(`${reference.title}\n${reference.text}`);
    const matchedKeywords = terms.filter(term => text.includes(norm(term))), knownMetrics = metricNames.filter(name => metrics[name].value !== null);
    const visibleInteractions = knownMetrics.length ? knownMetrics.reduce((total, name) => total + metrics[name].value, 0) : null;
    const sortValue = sortBy === 'general' ? visibleInteractions : metrics[sortBy].value;
    return { ...reference, discoveryRanking: { sampleRank: 0, sortBy, sortValue, matchedKeywords, visibleInteractions, knownMetrics, approximate: knownMetrics.some(name => metrics[name].approximate) } };
  });
  ranked.sort((a, b) => {
    const ar = a.discoveryRanking, br = b.discoveryRanking;
    const relevant = br.matchedKeywords.length - ar.matchedKeywords.length;
    return (sortBy === 'general' ? relevant || compareKnown(ar.sortValue, br.sortValue) : compareKnown(ar.sortValue, br.sortValue) || relevant)
      || Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id);
  });
  return ranked.map((reference, index) => ({ ...reference, discoveryRanking: { ...reference.discoveryRanking, sampleRank: index + 1 } }));
}

export function researchOf(project) {
  const current = project?.research && typeof project.research === 'object' && !Array.isArray(project.research) ? project.research : {};
  return { ...current, revision: Number.isSafeInteger(current.revision) && current.revision >= 0 ? current.revision : 0,
    references: Array.isArray(current.references) ? current.references : [], analyses: Array.isArray(current.analyses) ? current.analyses : [],
    selectedIds: Array.isArray(current.selectedIds) ? current.selectedIds : [], reports: Array.isArray(current.reports) ? current.reports : [], queries: list(current.queries) };
}

export function researchCorpus(projectOrReferences, projectId) {
  const isArray = Array.isArray(projectOrReferences), id = projectId || (!isArray && projectOrReferences?.id);
  if (typeof id !== 'string' || !id.trim()) fail('缺少研究所属项目');
  const references = isArray ? projectOrReferences : researchOf(projectOrReferences).references;
  return { id: `${id}-research`, corpus: references.slice(0, RESEARCH_MAX_REFERENCES).map(reference => {
    const text = `${reference.title}\n${reference.text}`, points = Array.from(text), chunks = [];
    for (let start = 0; start < points.length; start += 800) chunks.push({ index: chunks.length + 1, text: points.slice(start, start + 900).join('') });
    return { id: reference.id, name: cutUnits(`${reference.sourceName} · ${reference.title}`, 160), text, enabled: true, format: 'external-reference', importedAt: reference.collectedAt, chunks,
      referenceId: reference.id, sourceUrl: reference.url, publishedAt: reference.publishedAt, dateBasis: reference.dateBasis, kind: reference.kind };
  }) };
}

const analysisSchema = z.object({
  id: z.string().trim().min(1).max(160), title: z.string().trim().min(1).max(180), observation: z.string().trim().min(1).max(1200),
  hypothesis: z.string().trim().min(1).max(1200), application: z.string().trim().min(1).max(1200), tags: z.array(z.string().trim().min(1).max(50)).max(12),
  evidence: z.array(z.object({ referenceId: z.string().min(1).max(160), quote: z.string().trim().min(1).max(400) })).min(1).max(5),
  limitations: z.string().trim().min(1).max(1200),
});
const analysisOutput = z.object({ analyses: z.array(analysisSchema).max(6) });
const growthAdviceSchema = z.object({
  focus: z.enum(['title', 'opening', 'content', 'tags', 'engagement', 'experiment']),
  action: z.string().trim().min(1).max(800), reason: z.string().trim().min(1).max(800), validation: z.string().trim().min(1).max(800),
  referenceIds: z.array(z.string().trim().min(1).max(160)).min(1).max(5),
});
const discoveryOutput = z.object({ analyses: z.array(analysisSchema.extend({ growthAdvice: z.array(growthAdviceSchema).min(1).max(6) })).max(6) });
function optionsOf(project) {
  const state = researchOf(project);
  const current = project?.trends?.settings;
  return {
    blockTerms: Array.isArray(current?.blockTerms) ? list(current.blockTerms) : [...list(state.blockTerms), ...list(state.settings?.blockTerms)],
    genericTerms: Array.isArray(current?.genericTerms) ? list(current.genericTerms) : [...list(state.genericTerms), ...list(state.settings?.genericTerms)],
  };
}
function tagsOf(tags, blockTerms, genericTerms) {
  const common = new Set([...COMMON_WORDS, ...genericTerms].map(norm)), seen = new Set();
  return tags.map(tag => plain(tag).replace(/^#+|#+$/gu, '').trim()).filter(tag => {
    const value = norm(tag);
    if (Array.from(tag).length < 2 || Array.from(tag).length > 30 || common.has(value) || seen.has(value) || blocked(tag, blockTerms) || disputed(tag) || /https?:|www\.|[<>{}\[\]\\/]/iu.test(tag)) return false;
    seen.add(value); return true;
  }).slice(0, 8);
}
function unsupportedClaim(text) {
  const pattern = /全网(?:第一|最热|爆款|排名第一|领先)|(?:一定|必然|保证).{0,10}(?:涨粉|销量|成交|转化|曝光)|(?:证明|证实).{0,10}(?:因果|销量|转化|成交)|(?:导致|带来|拉动|提升).{0,6}(?:销量|成交|转化率|曝光量)/gu;
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(Math.max(0, match.index - 16), match.index);
    if (!/(?:不|未|无法|不能|并非|避免|可能|假设|待验证)[^。！？；\n]{0,12}$/u.test(prefix)) return true;
  }
  return false;
}

function validateAnalyses(value, payload, stored = false) {
  const discovery = discoveryOf(payload?.discovery);
  const parsed = (discovery ? discoveryOutput : analysisOutput).safeParse(value);
  if (!parsed.success) fail('热点分析结果格式不完整，请重试；已有内容已保留。', 502);
  if (!stored && parsed.data.analyses.some(item => item.id.length > 100)) fail('热点分析标识过长，请重试；已有内容已保留。', 502);
  const references = Array.isArray(payload?.references) ? payload.references : [], byId = new Map(references.map(reference => [reference.id, reference]));
  if (byId.size !== references.length) fail('热点分析输入含重复来源标识', 502);
  const blockTerms = list(payload?.blockTerms), genericTerms = list(payload?.genericTerms), ids = new Set(), analyses = [];
  for (const item of parsed.data.analyses) {
    if (ids.has(item.id)) fail('热点分析结果含重复标识', 502); ids.add(item.id);
    const used = [];
    for (const evidence of item.evidence) {
      const reference = byId.get(evidence.referenceId);
      if (!reference) fail('热点分析引用了本次输入之外的来源', 502);
      if (discovery && reference.kind !== 'xiaohongshu') fail('小红书内容发现引用了非小红书来源', 502);
      if (![reference.title, reference.text].some(text => typeof text === 'string' && text.includes(evidence.quote))) fail('热点分析的引用不是来源中的连续原文', 502);
      used.push(reference);
    }
    if (discovery) {
      const evidenceIds = new Set(item.evidence.map(evidence => evidence.referenceId));
      if (item.growthAdvice.some(advice => advice.referenceIds.some(id => !evidenceIds.has(id)))) fail('流量建议引用了本条分析证据之外的来源', 502);
    }
    const content = [item.title, item.observation, item.hypothesis, item.application, item.limitations, ...(item.growthAdvice || []).flatMap(advice => [advice.action, advice.reason, advice.validation])].join('\n');
    if (blocked(content, blockTerms) || disputed(content) || used.some(reference => blocked(`${reference.title}\n${reference.text}`, blockTerms) || disputed(`${reference.title}\n${reference.text}`)) || unsupportedClaim(content)) continue;
    const tags = tagsOf(item.tags, blockTerms, genericTerms); if (!tags.length) continue;
    const localRisk = riskFor(content + '\n' + tags.join('\n')), review = localRisk.risk === 'review' || used.some(reference => reference.risk === 'review');
    analyses.push({ ...item, ...(discovery ? { discovery, growthAdvice: item.growthAdvice.map(advice => ({ ...advice, referenceIds: [...new Set(advice.referenceIds)] })) } : {}), tags, evidence: item.evidence.filter((evidence, index, rows) => rows.findIndex(row => row.referenceId === evidence.referenceId && row.quote === evidence.quote) === index),
      limitations: item.limitations.includes(limitation) ? item.limitations : `${item.limitations.slice(0, 1200 - limitation.length - 1).replace(/[\uD800-\uDBFF]$/u, '')}\n${limitation}`, risk: review ? 'review' : 'unverified',
      riskReason: review ? '所选切入点或证据含人物、品牌、作品或商业实体线索；需逐项确认，不表示已获授权。' : '来源和权利状态未独立核实；只能借鉴内容结构与场景，不能当作项目已发生的事实。' });
  }
  return { analyses };
}

export function validateResearchAnalysis(value, payload) { return validateAnalyses(value, payload); }

function validSelected(project, at) {
  const state = researchOf(project), filters = optionsOf(project);
  const selected = state.analyses.filter(analysis => state.selectedIds.includes(analysis.id) && Array.isArray(analysis.evidence));
  const analyses = [], referenced = new Map();
  for (const candidate of selected) {
    try {
      // Each saved analysis owns its publication window. A later search cannot relax
      // old news rules or expire an explicitly timeless XHS reference.
      const discovery = discoveryOf(candidate.discovery), needed = new Set(candidate.evidence.map(evidence => evidence.referenceId));
      const raw = state.references.filter(reference => needed.has(reference.id));
      if (new Set(raw.map(reference => reference.id)).size !== raw.length) continue;
      const { references } = cleanReferences(raw, { ...filters, at, discovery });
      const validIds = new Set(references.map(reference => reference.id));
      if (!candidate.evidence.every(evidence => validIds.has(evidence.referenceId))) continue;
      const valid = validateAnalyses({ analyses: [candidate] }, { references, ...filters, discovery }, true).analyses;
      analyses.push(...valid);
      if (valid.length) for (const reference of references) referenced.set(reference.id, reference);
    } catch { /* Stale or edited evidence cannot enter a new generation. */ }
  }
  return { state, references: [...referenced.values()], analyses };
}

export function selectResearch(project, input, at = Date.now()) {
  const now = clock(typeof at === 'object' && !(at instanceof Date) ? at?.at : at);
  const data = z.object({ expectedRevision: z.number().int().nonnegative(), analysisIds: z.array(z.string().min(1).max(160)).max(5), acknowledgedIds: z.array(z.string().min(1).max(160)).max(5).default([]), confirmed: z.literal(true) }).strict().parse(input);
  const current = researchOf(project);
  if (data.expectedRevision !== current.revision) fail('热点分析已更新，请刷新后重新选择', 409);
  if (new Set(data.analysisIds).size !== data.analysisIds.length || data.acknowledgedIds.some(id => !data.analysisIds.includes(id))) fail('热点选择或风险确认标识无效');
  const { analyses } = validSelected({ ...project, research: { ...current, selectedIds: data.analysisIds } }, now);
  if (analyses.length !== data.analysisIds.length) fail('选中的热点已过期、被屏蔽或证据失效，请重新采集分析', 409);
  for (const analysis of analyses) if (analysis.risk === 'review' && !data.acknowledgedIds.includes(analysis.id)) fail('请逐项确认涉及人物、品牌或作品的名称使用风险');
  project.research = { ...current, selectedIds: [...data.analysisIds], acknowledgedIds: [...data.acknowledgedIds], selectedAt: new Date(now).toISOString(), revision: current.revision + 1 };
  return project.research;
}

export function selectedResearchContext(project, at = Date.now()) {
  const { state, references, analyses } = validSelected(project, clock(at)), byId = new Map(references.map(reference => [reference.id, reference]));
  return analyses.filter(analysis => analysis.risk !== 'review' || state.acknowledgedIds?.includes(analysis.id)).slice(0, 5).map(analysis => ({
    analysisId: analysis.id, title: analysis.title, observation: analysis.observation, hypothesis: analysis.hypothesis, application: analysis.application, tags: [...analysis.tags], limitations: analysis.limitations,
    ...(analysis.discovery ? { discovery: { ...analysis.discovery }, growthAdvice: analysis.growthAdvice.map(advice => ({ ...advice, referenceIds: [...advice.referenceIds] })) } : {}),
    risk: analysis.risk, riskReason: analysis.riskReason, evidence: analysis.evidence.map(evidence => { const reference = byId.get(evidence.referenceId); return { referenceId: reference.id, title: reference.title, url: reference.url, publishedAt: reference.publishedAt, dateBasis: reference.dateBasis, quote: evidence.quote }; }),
  }));
}
