import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rankTopicReferences } from '../server/topic-performance.mjs';
import { cleanReferences, validateResearchAnalysis, selectResearch, selectedResearchContext } from '../server/research-data.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

const at = Date.parse('2026-10-15T12:00:00Z'), day = 86400000;
const discovery = platform => ({ platform, timeRange: 'month', sortBy: 'general', noteType: 'all' });
function raw(n, platform = 'youtube', changes = {}) {
  const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${String(n).padStart(11, 'x')}` : platform === 'instagram' ? `https://www.instagram.com/p/testcase${n}` : platform === 'douyin' ? `https://www.douyin.com/video/${String(n).padStart(19, '7')}` : platform === 'tiktok' ? `https://www.tiktok.com/@fixture/video/${String(n).padStart(19, '8')}` : `https://www.xiaohongshu.com/explore/${String(n).padStart(24, 'a')}`;
  return { kind: platform, url, title: `学习搭子使用方法${n}`, text: '先讨论目标和时间，再约定学习搭子的沟通方式。', noteType: 'video', sourceName: platform, publishedAt: new Date(at - day).toISOString(), collectedAt: new Date(at).toISOString(), dateBasis: 'platform-timestamp', metrics: { views: n * 100, likes: n * 10 }, ...changes };
}
const clean = (rows, platform = 'youtube') => cleanReferences(rows, { at, discovery: discovery(platform) }).references;
function answer(reference) { return { analyses: [{ id: 'case', title: '明确学习安排的步骤', observation: '可见正文先明确目标与时间，再介绍沟通方式。', hypothesis: '明确安排可能减少读者的选择成本，需要验证。', application: '结合项目实际功能，分别展示目标与时间设置。', tags: ['搭子沟通步骤'], evidence: [{ referenceId: reference.id, quote: '先讨论目标和时间' }], limitations: '只有标题与描述和一次指标快照，未观看视频，也没有曝光或账号受众数据。', growthAdvice: [{ focus: 'opening', action: '测试先问时间安排和先说明目标的两种开头。', reason: '原文先列出时间和目标，只是可借鉴的观察。', validation: '固定主题与观察周期，每次只调整一个因素，比较自有账号能看到的收藏或评论；缺少曝光时不算转化率。', referenceIds: [reference.id] }] }] }; }

test('topic ranking excludes irrelevant viral candidates from AI evidence and never sums partial counters', () => {
  const references = clean([raw(1), raw(2, 'youtube', { title: '无关旅行攻略', text: '仅介绍旅游线路。', metrics: { views: 99999999 } }), raw(3, 'youtube', { metrics: { views: null, likes: 999999 } }), raw(4, 'youtube', { metrics: { views: 0 } })]);
  const original = structuredClone(references), result = rankTopicReferences(references, { keywords: ['学习搭子'], platform: 'youtube', sortBy: 'views' });
  assert.equal(result.references[0].title, '学习搭子使用方法1');
  assert.equal(result.references.at(-1).topicRanking.relevant, false);
  assert.equal(result.summary.unrelated, 1); assert.equal(result.summary.unknownMetrics, 1);
  assert.deepEqual(result.analysisReferences.map(ref => ref.metrics.views.value), [100, 0, null]);
  assert.equal(result.summary.sampleMedian, null); assert.equal(result.summary.metric, 'views');
  assert.deepEqual(references, original);
});

test('single-platform samples use honest known counters, preserve compact approximations, and select contrast peers', () => {
  const references = clean([...Array.from({ length: 12 }, (_, index) => raw(index + 1)), raw(50, 'instagram', { metrics: { views: 9999999 } })]);
  const result = rankTopicReferences(references, { keywords: ['学习搭子'], platform: 'youtube' });
  assert.equal(result.summary.total, 12); assert.equal(result.summary.sampleMedian, 650);
  assert.equal(result.analysisReferences.length, 10);
  assert.deepEqual(result.analysisReferences.slice(-2).map(ref => ref.topicRanking.value), [200, 100]);
  assert(result.analysisReferences.slice(-2).every(ref => ref.analysisRole === 'comparison-sample'));
  const xhs = rankTopicReferences(clean([raw(1, 'xiaohongshu', { metrics: { likes: '1.2万', shares: null, comments: 9 } })], 'xiaohongshu'), { keywords: ['学习搭子'] });
  assert.equal(xhs.summary.metric, 'likes'); assert.equal(xhs.references[0].topicRanking.value, 12000); assert.equal(xhs.references[0].topicRanking.approximate, true);
});

test('overseas topic words match complete Latin terms without treating paid or artifice as AI or art', () => {
  const refs = clean([raw(1, 'youtube', { title: 'Paid artifice examples', text: 'Paid demonstrations.' }), raw(2, 'youtube', { title: 'AI tools for art', text: 'AI工具用于辅助创作。' }), raw(3, 'youtube', { title: 'C++ study guide', text: 'A guide for C++ study.' })]);
  const result = rankTopicReferences(refs, { keywords: ['AI', 'art', 'C++'], platform: 'youtube' });
  assert.equal(result.summary.related, 2); assert.equal(result.references.at(-1).topicRanking.relevant, false);
});

test('canonical platform URLs strip tracking, reject cross-platform sources and keep valid unknown/zero metrics', () => {
  const rows = [raw(1, 'youtube', { url: 'https://youtu.be/xxxxxxxxxx1?si=tracking&access_token=secret' }), raw(2, 'youtube', { url: 'https://www.instagram.com/p/notyoutube' }), raw(3, 'douyin', { url: 'https://www.douyin.com/note/7777777777777777773' }), raw(4, 'instagram'), raw(5, 'tiktok')];
  const result = cleanReferences(rows, { at, discovery: discovery('youtube') });
  assert.equal(result.excluded.unsafeUrl, 1); assert.equal(result.references.length, 4);
  assert(result.references.some(ref => ref.url === 'https://www.youtube.com/watch?v=xxxxxxxxxx1'));
  assert(result.references.some(ref => ref.url === 'https://www.douyin.com/note/7777777777777777773'));
  assert(!JSON.stringify(result).includes('secret'));
});

test('saved multi-platform reference remains eligible only within its own verified platform and date window', () => {
  const refs = clean([raw(1)]), scope = discovery('youtube'), analyses = validateResearchAnalysis(answer(refs[0]), { references: refs, discovery: scope }).analyses;
  const project = { id: 'fixture-project', research: { revision: 0, references: refs, analyses, selectedIds: [] } };
  selectResearch(project, { expectedRevision: 0, analysisIds: ['case'], confirmed: true }, at);
  assert.equal(selectedResearchContext(project, at)[0].discovery.platform, 'youtube');
  assert.deepEqual(selectedResearchContext(project, at + 31 * day), []);
  assert.throws(() => validateResearchAnalysis(answer(refs[0]), { references: refs, discovery: discovery('instagram') }), /其他平台/);
});

async function fixture(t) {
  const store = createStore(':memory:'), calls = [], behavior = {}, id = store.get().projects[0].id;
  store.mutate(state => { state.projects[0].brief.budgetUsd = 5; state.projects[0].usage = []; });
  const app = createApp(store, { profileMode: true, deepseekVault: { status: () => ({ configured: true, supported: true }), getKey: async () => 'synthetic-only-key' }, fetcher: async (_url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content); calls.push({ kind: 'analysis', payload });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer(payload.references[0])) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } });
  } });
  app.locals.integrations.mcpResearchStatus = async (_req, options = {}) => ({ configured: true, supported: options.platform !== 'tiktok', note: '该连接不支持全站话题搜索', sourceAccountId: options.accountId || 'account-one', sourceAccountName: '本机测试账号' });
  app.locals.integrations.mcpResearchSearch = async (_req, args) => { calls.push({ kind: 'mcp', args }); return { items: [raw(1, 'youtube', { publishedAt: new Date(Date.now() - day).toISOString(), collectedAt: new Date().toISOString(), sourceAccountId: args.accountId, sourceAccountName: '本机测试账号', ...(behavior.unrelated ? { title: '旅行线路介绍', text: '只讨论旅游活动。' } : {}), ...(behavior.unknownMetrics ? { metrics: {} } : {}) })], reports: [] }; };
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  async function run(changes = {}) { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${id}/research/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ keywords: ['学习搭子'], sources: ['youtube'], discovery: discovery('youtube'), accountId: 'account-two', confirmed: true, expectedRevision: 0, ...changes }) }); return { status: response.status, body: await response.json() }; }
  return { calls, behavior, run, store };
}

test('multi-platform run pins the chosen account and transmits only topic evidence to a single analysis request', async t => {
  const f = await fixture(t), result = await f.run(); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(f.calls.map(call => call.kind), ['mcp', 'analysis']); assert.equal(f.calls[0].args.accountId, 'account-two'); assert.equal(f.calls[0].args.platform, 'youtube');
  assert.equal(result.body.result.run.sourceAccount.id, 'account-two'); assert.equal(result.body.result.references[0].sourceAccountId, 'account-two');
  assert.equal(f.calls[1].payload.references[0].sourceAccountId, undefined); assert(!JSON.stringify(f.calls[1].payload).includes('本机测试账号'));
  assert.equal(result.body.result.analyses[0].discovery.platform, 'youtube'); assert.equal(result.body.result.retrieval.comparison.metric, 'views');
});

test('unsupported search and unrelated candidates cannot trigger a paid analysis or pretend successful discovery', async t => {
  const unsupported = await fixture(t); assert.equal((await unsupported.run({ sources: ['tiktok'], discovery: discovery('tiktok') })).status, 400); assert.equal(unsupported.calls.length, 0);
  const unrelated = await fixture(t); unrelated.behavior.unrelated = true; const result = await unrelated.run(); assert.equal(result.status, 400); assert.deepEqual(unrelated.calls.map(call => call.kind), ['mcp']);
  assert.equal(unrelated.store.get().projects[0].research.references.length, 1); assert.equal(unrelated.store.get().projects[0].usage.length, 0);
  const unknown = await fixture(t); unknown.behavior.unknownMetrics = true; assert.equal((await unknown.run()).status, 400); assert.deepEqual(unknown.calls.map(call => call.kind), ['mcp']);
  assert.equal(unknown.store.get().projects[0].research.retrieval.comparison.knownMetrics, 0); assert.equal(unknown.store.get().projects[0].usage.length, 0);
});
