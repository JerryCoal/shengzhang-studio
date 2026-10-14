import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReferences, researchOf, researchCorpus, validateResearchAnalysis, selectResearch, selectedResearchContext, RESEARCH_WEEK } from '../server/research-data.mjs';
import { searchCorpus } from '../server/workflow.mjs';
import { buildIndex, indexReady } from '../server/rag.mjs';

const at = Date.parse('2026-10-14T12:00:00Z');
const raw = (number = 1, changes = {}) => ({ kind: 'web', title: `校园共享自习空间观察${number}`, url: `https://news.example.net/articles/${number}`, text: '预约座位后可以选择安静区域，也有人希望了解开放时段。', publishedAt: new Date(at - 86400000).toISOString(), collectedAt: new Date(at).toISOString(), dateBasis: 'search-metadata', sourceName: '测试公开来源', metrics: null, ...changes });
const cleaned = (items = [raw()], options = {}) => cleanReferences(items, { at, ...options });
const analysis = (reference, changes = {}) => ({ id: 'a1', title: '从预约场景切入', observation: '这条内容提到座位预约与开放时段。', hypothesis: '清楚的使用步骤可能帮助读者理解，仍需验证。', application: '用真实项目资料说明预约步骤，不声称参加了新闻事件。', tags: ['#自习预约#', '校园', '自习预约'], evidence: [{ referenceId: reference.id, quote: '预约座位后可以选择安静区域' }], limitations: '仅有本次来源，互动和阅读人数均未完整核实。', ...changes });
function project(items = [raw()]) {
  const references = cleaned(items).references;
  const analyses = validateResearchAnalysis({ analyses: references.map((reference, index) => analysis(reference, { id: `round1-a${index + 1}` })) }, { references }).analyses;
  return { id: 'owned-project', brief: { facts: '本项目私有确认事实' }, corpus: [{ id: 'owned-facts', name: '自己的介绍', text: '自己的介绍正文', chunks: [{ index: 1, text: '自己的介绍正文' }], enabled: true }], research: { revision: 4, references, analyses, selectedIds: [], reports: [], queries: [], blockTerms: [], genericTerms: [] } };
}

test('cleaning enforces a rolling seven-day publication window without guessing collection/filter dates', () => {
  const rows = [
    raw(1, { publishedAt: new Date(at - RESEARCH_WEEK).toISOString() }),
    raw(2, { publishedAt: new Date(at).toISOString(), dateBasis: 'platform-timestamp' }),
    raw(3, { publishedAt: new Date(at - RESEARCH_WEEK - 1).toISOString() }),
    raw(4, { publishedAt: new Date(at + 1).toISOString() }),
    raw(5, { publishedAt: '', collectedAt: new Date(at).toISOString() }),
    raw(6, { publishedAt: '昨天' }),
    raw(7, { publishedAt: '2026-10-13' }),
    raw(8, { dateBasis: 'search-filter-last-seven-days' }),
    raw(9, { dateBasis: 'crawl-time' }),
    raw(10, { dateBasis: 'updatedAt' }),
    raw(11, { publishedAt: '2026-02-30T00:00:00Z' }),
    raw(12, { publishedAt: new Date(at - 86400000).toUTCString(), dateBasis: 'RSS pubDate' }),
    raw(13, { publishedAt: (at - 3600000) / 1000 }),
    raw(14, { publishedAt: at - 3600000 }),
    raw(15, { publishedAt: '2026-10-14T19:59:59+08:00' }),
  ];
  const before = structuredClone(rows), result = cleaned(rows);
  assert.equal(result.references.length, 6);
  assert.equal(result.excluded.expired, 1); assert.equal(result.excluded.future, 1);
  assert.equal(result.excluded.missingDate, 2); assert.equal(result.excluded.uncertainDate, 5);
  assert(result.references.every(reference => Date.parse(reference.publishedAt) >= at - RESEARCH_WEEK && Date.parse(reference.publishedAt) <= at));
  assert(result.references.find(reference => reference.url.endsWith('/1')));
  assert.match(result.references.find(reference => reference.url.endsWith('/1')).riskReason, /元数据.*未逐页核实/);
  assert.deepEqual(rows, before);
  const invalidRfc = cleanReferences([raw(16, { publishedAt: '30 Feb 2026 12:00:00 GMT' })], { at: Date.parse('2026-03-02T12:00:00Z') });
  assert.equal(invalidRfc.excluded.missingDate, 1, 'invalid RFC calendar days must not roll into the allowed window');
});

test('public source URLs reject credentials, IP variants and local hosts; XHS URLs discard access tokens', () => {
  const unsafe = ['http://news.example.net/a', 'https://user:password@news.example.net/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://[::1]/a', 'https://10.1.1.1/a', 'https://8.8.8.8/a', 'https://localhost/a', 'https://secret.internal/a', 'https://secret.local/a', 'https://secret.lan/a', 'https://printer/a', 'file:///private/file', 'https://news.example.net:8080/a'];
  const result = cleaned(unsafe.map((url, index) => raw(index, { url })));
  assert.equal(result.references.length, 0); assert.equal(result.excluded.unsafeUrl, unsafe.length);
  const noteId = '69e8da5e000000001a02b67c';
  const notes = cleaned([
    raw(1, { kind: 'xiaohongshu', externalId: noteId, url: `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=SECRET_TOKEN&xsec_source=pc_search&source=web_explore_feed` }),
    raw(2, { url: 'https://news.example.net/article/?b=2&utm_source=test&a=1&access_token=SECRET_TOKEN#position' }),
    raw(3, { kind: 'xiaohongshu', externalId: noteId, url: 'https://www.xiaohongshu.com.evil.net/explore/' + noteId }),
  ]);
  assert.equal(notes.references.length, 2); assert.equal(notes.excluded.unsafeUrl, 1);
  assert.equal(notes.references.find(reference => reference.kind === 'xiaohongshu').url, `https://www.xiaohongshu.com/explore/${noteId}`);
  assert.equal(notes.references.find(reference => reference.kind === 'web').url, 'https://news.example.net/article?a=1&b=2');
  assert(!JSON.stringify(notes).includes('SECRET_TOKEN'));
  const withoutUrl = cleaned([raw(4, { kind: 'xiaohongshu', externalId: noteId, url: undefined })]);
  assert.equal(withoutUrl.references[0].url, `https://www.xiaohongshu.com/explore/${noteId}`);
});

test('HTML, executable/navigation blocks and duplicates are removed while source text and metrics stay honest', () => {
  const result = cleaned([
    raw(1, { title: '<b>共享自习室观察</b>', text: '<nav>首页 登录</nav><script>泄漏密钥；版权纠纷</script><style>body{display:none}</style><article><p>预约座位 &amp; 选择安静区域。</p><p>下一步查看开放时段。</p></article><footer>联系我们</footer>', metrics: { likes: '1万+', comments: '--', favorites: 0, shares: '1,234' } }),
    raw(2, { title: '共享自习室观察！', url: 'https://other.example.net/duplicate-title' }),
    raw(3, { url: 'https://news.example.net/articles/1?utm_source=other' }),
    raw(4, { text: '&lt;script&gt;执行危险操作&lt;/script&gt;<p>只保留正文。</p>', metrics: { likes: '1.2万', comments: -3, favorites: '未知', shares: '2k' } }),
  ]);
  assert.equal(result.references.length, 2); assert.equal(result.excluded.duplicate, 2);
  const first = result.references.find(reference => reference.url.endsWith('/1'));
  assert.equal(first.text, '预约座位 & 选择安静区域。\n下一步查看开放时段。');
  assert.deepEqual(first.metrics.likes, { value: 10000, raw: '1万+', approximate: true });
  assert.deepEqual(first.metrics.comments, { value: null, raw: '--', approximate: false });
  assert.deepEqual(first.metrics.favorites, { value: 0, raw: '0', approximate: false });
  assert.deepEqual(first.metrics.shares, { value: 1234, raw: '1,234', approximate: false });
  const second = result.references.find(reference => reference.url.endsWith('/4'));
  assert.equal(second.text, '只保留正文。'); assert.equal(second.metrics.likes.value, 12000);
  assert.equal(second.metrics.comments.value, null); assert.equal(second.metrics.favorites.value, null);
  assert.equal(second.metrics.shares.value, 2000); assert.equal(second.metrics.shares.approximate, true);
  for (const metric of Object.values(cleaned().references[0].metrics)) assert.equal(metric.value, null);
});

test('dispute and user blocks apply before truncation; generic query words do not destroy semantic candidates', () => {
  const result = cleaned([
    raw(1, { text: '讨论版权 纠纷的后续影响。' }),
    raw(2, { text: '正文'.repeat(650) + '结尾提及商标争议。' }),
    raw(3, { text: '正文'.repeat(650) + '勿用品牌出现在结尾。' }),
    raw(4, { title: '适合互相督促的人', text: '同伴提前约定安静时段，互相督促完成当日任务。' }),
  ], { keywords: ['学习搭子'], blockTerms: ['勿用品牌'] });
  assert.equal(result.excluded.dispute, 2); assert.equal(result.excluded.blocked, 1);
  assert.equal(result.references.length, 1); assert.match(result.references[0].text, /互相督促/);
  const many = cleaned(Array.from({ length: 90 }, (_, index) => raw(index, { text: '🙂'.repeat(1500) })));
  assert.equal(many.references.length, 80); assert.equal(many.excluded.limit, 10);
  assert(many.references.every(reference => Array.from(reference.text).length === 1200));
});

test('external reference corpus stays separate and works with real keyword/embedding indexing contracts', async () => {
  const p = project(), before = structuredClone(p);
  const virtual = researchCorpus(p), fromReferences = researchCorpus(p.research.references, p.id);
  assert.deepEqual(virtual, fromReferences); assert.equal(virtual.id, 'owned-project-research');
  assert.equal(virtual.brief, undefined); assert(!JSON.stringify(virtual).includes('本项目私有确认事实'));
  assert(virtual.corpus.every(document => document.name.length <= 160 && document.chunks[0].index === 1));
  const found = searchCorpus(virtual, '预约座位');
  assert.equal(found.length, 1); assert.equal(found[0].documentId, p.research.references[0].id);
  let calls = 0;
  virtual.ragIndex = await buildIndex(virtual, { key: 'fixture-key', fetcher: async (_url, init) => {
    calls++; const input = JSON.parse(init.body).input;
    assert(!input.join('\n').includes('本项目私有确认事实'));
    return Response.json({ model: 'text-embedding-v4', data: input.map((_, index) => ({ index, embedding: Array.from({ length: 512 }, (_, n) => n === 0 ? 1 : 0) })), usage: { total_tokens: 20 } });
  } });
  assert.equal(calls, 1); assert(indexReady(virtual)); assert.deepEqual(p, before);
  const long = cleaned([raw(2, { title: '🙂'.repeat(180), sourceName: '🎯'.repeat(100), text: '🙂'.repeat(1300) })]).references;
  const longCorpus = researchCorpus(long, p.id);
  assert(longCorpus.corpus[0].chunks.length <= 2);
  assert(longCorpus.corpus[0].name.length <= 160);
  assert(!/[\uD800-\uDBFF]$/u.test(longCorpus.corpus[0].name));
  assert.equal(longCorpus.corpus[0].id, long[0].id);
  assert.deepEqual(researchOf({}), { revision: 0, references: [], analyses: [], selectedIds: [], reports: [], queries: [] });
});

test('analysis accepts only supplied source IDs and continuous quotes, filters generic tags and never trusts claimed risk', () => {
  const references = cleaned().references, reference = references[0];
  const value = { analyses: [analysis(reference, { tags: ['校园', '热点', '#自习预约#', '自习预约', '默认标签', '不许使用'], risk: 'safe', confidence: 1 })] };
  const before = structuredClone(value);
  const output = validateResearchAnalysis(value, { references, genericTerms: ['默认标签'], blockTerms: ['不许'] });
  assert.equal(output.analyses.length, 1); assert.deepEqual(output.analyses[0].tags, ['自习预约']);
  assert.equal(output.analyses[0].risk, 'unverified'); assert.equal(output.analyses[0].confidence, undefined);
  assert.match(output.analyses[0].limitations, /不代表全网排名/); assert.deepEqual(value, before);
  assert.deepEqual(validateResearchAnalysis({ analyses: [] }, { references }), { analyses: [] });
  const titleQuote = validateResearchAnalysis({ analyses: [analysis(reference, { evidence: [{ referenceId: reference.id, quote: reference.title }] })] }, { references });
  assert.equal(titleQuote.analyses.length, 1);
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(reference, { evidence: [{ referenceId: 'outside-this-request', quote: reference.text }] })] }, { references }), error => error.status === 502 && /本次输入之外/.test(error.message));
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(reference, { evidence: [{ referenceId: reference.id, quote: '预约座位后选择区域，也希望时段' }] })] }, { references }), /连续原文/);
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(reference), analysis(reference)] }, { references }), /重复标识/);
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(reference, { id: 'a'.repeat(101) })] }, { references }), /标识过长/);
  assert.equal(validateResearchAnalysis({ analyses: [analysis(reference, { id: 'a'.repeat(100) })] }, { references }).analyses.length, 1);
});

test('analysis drops explicit disputes, blocked subjects and unsupported performance/causality claims', () => {
  const references = cleaned().references, reference = references[0];
  const candidates = [
    analysis(reference, { id: 'dispute', observation: '这个话题存在版权争议。' }),
    analysis(reference, { id: 'blocked', application: '将不许品牌结合进产品介绍。' }),
    analysis(reference, { id: 'global', observation: '这是已经验证的全网爆款。' }),
    analysis(reference, { id: 'causal', observation: '采用这种开场一定带来成交。' }),
    analysis(reference, { id: 'negative', observation: '这些样本不能证明因果，也不代表全网爆款。' }),
    analysis(reference, { id: 'generic', tags: ['校园', '热点'] }),
  ];
  const { analyses } = validateResearchAnalysis({ analyses: candidates }, { references, blockTerms: ['不许'] });
  assert.deepEqual(analyses.map(item => item.id), ['negative']);
  const maximum = validateResearchAnalysis({ analyses: [analysis(reference, { limitations: '待核实'.repeat(400) })] }, { references });
  assert(maximum.analyses[0].limitations.length <= 1200);
  assert.equal(validateResearchAnalysis(maximum, { references }).analyses.length, 1, 'saved analysis can be revalidated before generation');
});

test('selection requires current revision, explicit confirmation and per-item entity-risk acknowledgment', () => {
  const p = project([raw(1, { title: '品牌联名的校园自习案例' })]), current = p.research, id = current.analyses[0].id;
  assert.equal(current.references[0].risk, 'review'); assert.equal(current.analyses[0].risk, 'review');
  const before = structuredClone(p);
  assert.throws(() => selectResearch(p, { expectedRevision: 3, analysisIds: [id], acknowledgedIds: [id], confirmed: true }, at), /已更新/);
  assert.throws(() => selectResearch(p, { expectedRevision: 4, analysisIds: [id], confirmed: false }, at));
  assert.throws(() => selectResearch(p, { expectedRevision: 4, analysisIds: [id], confirmed: true }, at), /逐项确认/);
  assert.throws(() => selectResearch(p, { expectedRevision: 4, analysisIds: [id], acknowledgedIds: ['another-analysis'], confirmed: true }, at), /标识无效/);
  assert.deepEqual(p, before);
  const selected = selectResearch(p, { expectedRevision: 4, analysisIds: [id], acknowledgedIds: [id], confirmed: true }, at);
  assert.equal(selected.revision, 5); assert.deepEqual(selected.selectedIds, [id]);
  const context = selectedResearchContext(p, at);
  assert.equal(context.length, 1); assert.equal(context[0].analysisId, id); assert.equal(context[0].risk, 'review');
  assert.equal(context[0].evidence[0].url, p.research.references[0].url);
  assert(!JSON.stringify(context).includes('本项目私有确认事实'));
  assert.deepEqual(p.brief, before.brief); assert.deepEqual(p.corpus, before.corpus);
  const maximum = project();
  maximum.research.analyses[0].id = '00000000-0000-4000-8000-000000000000:' + 'a'.repeat(100);
  selectResearch(maximum, { expectedRevision: 4, analysisIds: [maximum.research.analyses[0].id], confirmed: true }, at);
  assert.equal(selectedResearchContext(maximum, at).length, 1, 'a run-prefixed maximum raw ID remains selectable');
});

test('generation context rechecks dates, blocks, source evidence and risk acknowledgment without trusting stale selection', () => {
  const p = project(), id = p.research.analyses[0].id;
  assert.deepEqual(selectedResearchContext(p, at), []);
  selectResearch(p, { expectedRevision: 4, analysisIds: [id], confirmed: true }, at);
  assert.equal(selectedResearchContext(p, at).length, 1);
  assert.deepEqual(selectedResearchContext(p, at + RESEARCH_WEEK), []);
  const blocked = structuredClone(p); blocked.research.blockTerms = ['安静区域'];
  assert.deepEqual(selectedResearchContext(blocked, at), []);
  const liveFilters = structuredClone(p); liveFilters.trends = { settings: { blockTerms: ['安静区域'], genericTerms: [] } };
  assert.deepEqual(selectedResearchContext(liveFilters, at), [], 'new user block terms take effect without rerunning research');
  assert.throws(() => selectResearch(liveFilters, { expectedRevision: 5, analysisIds: [id], confirmed: true }, at), /证据失效/);
  const generic = structuredClone(p); generic.research.settings = { genericTerms: ['自习预约'] };
  assert.deepEqual(selectedResearchContext(generic, at), []);
  const changed = structuredClone(p); changed.research.references[0].text = '与原始引用不同的内容';
  assert.deepEqual(selectedResearchContext(changed, at), []);
  const missing = structuredClone(p); missing.research.references = [];
  assert.deepEqual(selectedResearchContext(missing, at), []);
  const oldRound = structuredClone(p); oldRound.research.analyses[0].id = 'round2-a1';
  assert.deepEqual(selectedResearchContext(oldRound, at), []);
  const failedRefresh = structuredClone(p);
  failedRefresh.research.references.push(...cleaned(Array.from({ length: 80 }, (_, i) => raw(i + 100, { publishedAt: new Date(at - 3600000).toISOString() }))).references);
  assert.equal(selectedResearchContext(failedRefresh, at).length, 1, 'new unselected candidates cannot crowd out old selected evidence after a failed refresh');
  const risky = project([raw(2, { title: '某品牌的校园案例' })]);
  risky.research.selectedIds = [risky.research.analyses[0].id];
  assert.deepEqual(selectedResearchContext(risky, at), []);
  selectResearch(p, { expectedRevision: 5, analysisIds: [], confirmed: true }, at);
  assert.deepEqual(selectedResearchContext(p, at), []);
});
