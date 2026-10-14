import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReferences, rankXhsReferences, validateResearchAnalysis, selectedResearchContext, selectResearch, RESEARCH_WEEK } from '../server/research-data.mjs';
import { researchDefinition, researchInstructions } from '../server/research-ai.mjs';

const at = Date.parse('2026-10-14T12:00:00Z'), day = 86400000;
const discovery = (timeRange = 'week', sortBy = 'general') => ({ timeRange, sortBy, noteType: 'all' });
const raw = (n, changes = {}) => ({
  kind: 'xiaohongshu', externalId: n.toString(16).padStart(24, '0'), title: `自习预约步骤案例${n}`,
  text: '先选安静区域，再预约座位。文末询问读者习惯的自习时段。', publishedAt: new Date(at - day).toISOString(),
  collectedAt: new Date(at).toISOString(), dateBasis: 'platform-timestamp', sourceName: '小红书', metrics: {}, ...changes,
});
const cleaned = (rows, options = {}) => cleanReferences(rows, { at, ...options }).references;
const advice = (ref, changes = {}) => ({ focus: 'opening', action: '测试先问使用时段与先讲预约步骤两种开头。', reason: '原文按步骤介绍，先提问是否更贴近需求仍待验证。', validation: '保持主题与正文一致，记录相近发布时段的可见评论数；样本不足则继续观察。', referenceIds: [ref.id], ...changes });
const analysis = (ref, changes = {}) => ({ id: `case-${ref.id}`, title: '预约场景的开头测试', observation: '可见正文用两步说明预约，并在结尾询问使用习惯。', hypothesis: '问题式开头可能促进读者表达需求，需要验证。', application: '结合项目已确认功能，独立写出预约过程。', tags: ['预约步骤拆解'], evidence: [{ referenceId: ref.id, quote: '先选安静区域，再预约座位' }], limitations: '仅分析已返回的正文摘录与可见互动计数；没有曝光数据。', ...changes });

test('discovery widens only XHS publication windows and still rejects unknown/future/unsafe evidence', () => {
  const rows = [raw(1), raw(2, { publishedAt: new Date(at - 20 * day).toISOString() }), raw(3, { publishedAt: new Date(at - 90 * day).toISOString() }),
    raw(4, { publishedAt: new Date(at + 1).toISOString() }), raw(5, { publishedAt: '' }), raw(6, { dateBasis: 'search-filter-last-month' }),
    raw(7, { kind: 'web', url: 'https://news.example.net/old', publishedAt: new Date(at - 20 * day).toISOString() }),
    raw(8, { kind: 'rss', url: 'https://news.example.net/feed/old', publishedAt: new Date(at - 20 * day).toISOString() }),
    raw(9, { url: 'https://127.0.0.1/private' }), raw(10, { text: '这篇内容涉及版权争议。' }), raw(11, { text: '用户禁用词出现。' })];
  assert.equal(cleaned(rows).length, 2);
  assert.equal(cleaned(rows, { discovery: discovery('month') }).length, 3);
  const result = cleanReferences(rows, { at, discovery: discovery('all'), blockTerms: ['用户禁用词'] });
  assert.equal(result.references.length, 3);
  assert.equal(result.excluded.expired, 2, 'old web and RSS references keep the seven-day requirement');
  for (const [reason, count] of Object.entries({ future: 1, missingDate: 1, uncertainDate: 1, unsafeUrl: 1, dispute: 1, blocked: 1 })) assert.equal(result.excluded[reason], count);
  assert.throws(() => cleaned(rows, { discovery: { ...discovery(), timeRange: 'forever' } }), /筛选无效/);
  assert.throws(() => cleaned(rows, { discovery: { ...discovery(), allowUnknownDates: true } }), /筛选无效/);
  const boundary = [raw(12, { publishedAt: new Date(at - 30 * day).toISOString() }), raw(13, { publishedAt: new Date(at - 30 * day - 1).toISOString() })];
  assert.equal(cleaned(boundary, { discovery: discovery('month') }).length, 1);
});

test('sample ranking distinguishes missing from zero, explains partial sums, and preserves source values', () => {
  const references = cleaned([
    raw(1, { metrics: { likes: '--', comments: '8', favorites: '--', shares: '--' } }),
    raw(2, { metrics: { likes: 0, comments: 0, favorites: 0, shares: 0 } }),
    raw(3, { metrics: { likes: '1.2万', comments: '2', favorites: '9', shares: null } }),
    raw(4, { metrics: {} }),
    raw(5, { kind: 'web', url: 'https://news.example.net/test', metrics: { likes: 999999 } }),
  ]);
  const original = structuredClone(references), ranked = rankXhsReferences(references, { keywords: ['预约', '预约', '安静区域'], sortBy: 'likes' });
  assert.deepEqual(ranked.map(ref => ref.title.at(-1)), ['3', '2', '1', '4']);
  assert.deepEqual(ranked.map(ref => ref.discoveryRanking.sampleRank), [1, 2, 3, 4]);
  assert.equal(ranked[1].discoveryRanking.sortValue, 0);
  assert.equal(ranked[2].discoveryRanking.sortValue, null);
  assert.equal(ranked[2].discoveryRanking.visibleInteractions, 8);
  assert.deepEqual(ranked[2].discoveryRanking.knownMetrics, ['comments']);
  assert.equal(ranked[3].discoveryRanking.visibleInteractions, null);
  assert.equal(ranked[0].discoveryRanking.visibleInteractions, 12011);
  assert.equal(ranked[0].discoveryRanking.approximate, true);
  assert.deepEqual(ranked[0].discoveryRanking.matchedKeywords, ['预约', '安静区域']);
  assert.deepEqual(references, original);
  assert.throws(() => rankXhsReferences(references, { sortBy: 'exposure' }), /排序方式无效/);
});

test('general ordering prioritizes literal relevance; selected counters rank only the returned sample', () => {
  const rows = cleaned([
    raw(1, { title: '预约案例', text: '说明预约步骤。', metrics: { likes: 100000, favorites: 1, comments: 2 } }),
    raw(2, { title: '预约安静区域', text: '先核对安静区域再预约。', metrics: { likes: 2, favorites: 60, comments: 5 } }),
    raw(3, { title: '日常观察', text: '讨论其他时段。', metrics: { likes: 200000, favorites: null, comments: 8 } }),
  ]);
  const keywords = ['预约', '安静区域'];
  assert.deepEqual(rankXhsReferences(rows, { keywords }).map(ref => ref.title), ['预约安静区域', '预约案例', '日常观察']);
  assert.deepEqual(rankXhsReferences(rows, { keywords, sortBy: 'favorites' }).map(ref => ref.title), ['预约安静区域', '预约案例', '日常观察']);
  assert.deepEqual(rankXhsReferences(rows, { keywords, sortBy: 'comments' }).map(ref => ref.title), ['日常观察', '预约安静区域', '预约案例']);
});

test('XHS growth advice requires explicit evidence and cannot cite a different analysis or spoof search settings', () => {
  const references = cleaned([raw(1), raw(2)]), ref = references[0], other = references[1], payload = { references, discovery: discovery('month', 'favorites') };
  const valid = analysis(ref, { growthAdvice: [advice(ref)], discovery: discovery('all') });
  const output = validateResearchAnalysis({ analyses: [valid] }, payload);
  assert.deepEqual(output.analyses[0].discovery, payload.discovery);
  assert.deepEqual(output.analyses[0].growthAdvice, valid.growthAdvice);
  for (const growthAdvice of [undefined, [], Array.from({ length: 7 }, () => advice(ref)), [advice(ref, { focus: 'exposure' })], [advice(ref, { referenceIds: [] })]]) {
    assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, { growthAdvice })] }, payload), /格式不完整/);
  }
  for (const referenceIds of [[other.id], ['made-up-reference']]) assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, { growthAdvice: [advice(ref, { referenceIds })] }), analysis(other, { growthAdvice: [advice(other)] })] }, payload), /本条分析证据之外/);
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, { growthAdvice: [advice(ref)], evidence: [{ referenceId: ref.id, quote: '不存在的引文' }] })] }, payload), /连续原文/);
  const web = cleaned([raw(3, { kind: 'web', url: 'https://news.example.net/web' })])[0];
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(web, { growthAdvice: [advice(web)] })] }, { ...payload, references: [web] }), /非小红书来源/);
  assert.deepEqual(validateResearchAnalysis({ analyses: [] }, payload), { analyses: [] });
  assert.equal(validateResearchAnalysis({ analyses: [analysis(ref, { growthAdvice: [advice(ref, { action: '这个开头保证涨粉。' })] })] }, payload).analyses.length, 0);
  assert.equal(validateResearchAnalysis({ analyses: [analysis(ref, { growthAdvice: [advice(ref, { reason: '借用勿用词营造相关性。' })] })] }, { ...payload, blockTerms: ['勿用词'] }).analyses.length, 0);
});

test('selected context owns each saved analysis window and carries only verified growth suggestions into copy', () => {
  const recent = cleaned([raw(1)])[0], old = cleaned([raw(2, { publishedAt: new Date(at - 20 * day).toISOString() })], { discovery: discovery('all') })[0];
  const legacy = validateResearchAnalysis({ analyses: [analysis(recent, { id: 'legacy' })] }, { references: [recent] }).analyses[0];
  const timeless = validateResearchAnalysis({ analyses: [analysis(old, { id: 'timeless', growthAdvice: [advice(old)] })] }, { references: [old], discovery: discovery('all') }).analyses[0];
  const monthly = validateResearchAnalysis({ analyses: [analysis(old, { id: 'monthly', growthAdvice: [advice(old)] })] }, { references: [old], discovery: discovery('month') }).analyses[0];
  const project = { id: 'fixture-only', research: { revision: 0, references: [recent, old], analyses: [legacy, timeless, monthly], selectedIds: [], discovery: discovery('week') } };
  selectResearch(project, { expectedRevision: 0, analysisIds: ['legacy', 'timeless', 'monthly'], confirmed: true }, at);
  const context = selectedResearchContext(project, at);
  assert.deepEqual(context.map(value => value.analysisId), ['legacy', 'timeless', 'monthly']);
  assert.equal(context[0].discovery, undefined);
  assert.equal(context[0].growthAdvice, undefined);
  assert.equal(context[1].discovery.timeRange, 'all');
  assert.deepEqual(context[1].growthAdvice[0].referenceIds, [old.id]);
  project.research.discovery = discovery('all');
  assert.deepEqual(selectedResearchContext(project, at + 11 * day).map(value => value.analysisId), ['timeless'], 'new global search settings neither relax old news nor expire timeless samples');
  const changed = structuredClone(project); changed.research.analyses[1].growthAdvice[0].referenceIds = [recent.id];
  assert.deepEqual(selectedResearchContext(changed, at + 11 * day), []);
  const blocked = structuredClone(project); blocked.trends = { settings: { blockTerms: ['安静区域'] } };
  assert.deepEqual(selectedResearchContext(blocked, at), []);
  const missingDate = structuredClone(project); missingDate.research.references[1].publishedAt = '';
  assert.deepEqual(selectedResearchContext(missingDate, at).map(value => value.analysisId), ['legacy']);
  assert.equal(selectedResearchContext(project, at + RESEARCH_WEEK)[0].analysisId, 'timeless');
});

test('the dedicated AI contract requires bounded actionable advice while legacy analysis remains compatible', () => {
  const fields = researchDefinition('xhs-analysis').schema.properties.analyses.items;
  assert(fields.required.includes('growthAdvice'));
  assert.equal(fields.properties.growthAdvice.minItems, 1);
  assert.equal(fields.properties.growthAdvice.maxItems, 6);
  assert.deepEqual(fields.properties.growthAdvice.items.properties.focus.enum, ['title', 'opening', 'content', 'tags', 'engagement', 'experiment']);
  assert(!researchDefinition('analysis').schema.properties.analyses.items.required.includes('growthAdvice'));
  assert.match(researchInstructions('xhs-analysis'), /待测试假设/);
  const ref = cleaned([raw(1)])[0];
  assert.equal(validateResearchAnalysis({ analyses: [analysis(ref)] }, { references: [ref] }).analyses.length, 1);
});
