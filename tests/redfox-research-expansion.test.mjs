import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRedfoxSocial } from '../server/redfox-social.mjs';
import { REDFOX_SOCIAL_OPERATIONS } from '../server/redfox-social-catalog.mjs';
import { redfoxXhsResearchPlan } from '../server/redfox-research-plan.mjs';
import { cleanReferences } from '../server/research-data.mjs';

const at = Date.parse('2026-01-10T04:00:00Z');
const workId = n => n.toString(16).padStart(24, '0');
const row = (n, changes = {}) => ({ workId: workId(n), workTitle: `主题样本 ${n}`, workDesc: `主题样本 ${n} 的可核对正文`, workPublishTime: '2026-01-09 12:00:00', workType: 'normal', ...changes });
const input = { projectId: 'p', platform: 'xiaohongshu', queries: ['主题'], at, discovery: { timeRange: 'week', sortBy: 'likes', noteType: 'all' } };
function fixture(onRequest) {
  const calls = [], req = { teamUser: { userId: 'editor', role: 'editor' } };
  const redfox = { enabled: () => true, status: () => ({ configured: true }), request: async (operation, body, context) => { calls.push({ operation, body, context }); return onRequest(operation, body, context); } };
  const social = mountRedfoxSocial({ post() {}, get() {} }, { get: () => ({ projects: [] }) }, { redfox, teamMode: true, authorizeCredentials: () => true }, { project: () => {}, activeJobs: new Set() });
  return { calls, search: changes => social.researchSearch(req, { ...input, ...changes }) };
}

test('XHS confirmation and collector share catalog prices and a whole-run three-detail budget', () => {
  assert.deepEqual(redfoxXhsResearchPlan(1), { maxPagesPerKeyword: 1, maxDetails: 0, maxSearchRequests: 1, maxRequests: 1, estimatedCny: .04 });
  assert.deepEqual(redfoxXhsResearchPlan(1, true), { maxPagesPerKeyword: 2, maxDetails: 3, maxSearchRequests: 2, maxRequests: 5, estimatedCny: .20 });
  assert.deepEqual(redfoxXhsResearchPlan(3, true), { maxPagesPerKeyword: 2, maxDetails: 3, maxSearchRequests: 6, maxRequests: 9, estimatedCny: .36 });
  const plan = redfoxXhsResearchPlan(3, true);
  assert.equal(plan.estimatedCny, Math.round((6 * REDFOX_SOCIAL_OPERATIONS['social.search.xiaohongshu'].priceCny + 3 * REDFOX_SOCIAL_OPERATIONS['social.detail.xiaohongshu'].priceCny) * 100) / 100);
  for (const count of [0, -1, NaN, Infinity]) assert.equal(redfoxXhsResearchPlan(count, true).maxRequests, 0);
  assert.equal(redfoxXhsResearchPlan(0, true).maxDetails, 0);
  assert.deepEqual(redfoxXhsResearchPlan(99, true), redfoxXhsResearchPlan(3, true));
  assert.deepEqual(redfoxXhsResearchPlan(2.9, true), redfoxXhsResearchPlan(2, true));
});

test('recent windows use the official latest sort without enabling extra calls for old clients', async () => {
  for (const timeRange of ['week', 'month']) {
    const f = fixture(() => ({ list: [row(1, { workDesc: '', workPublishTime: '' })], hasMore: true }));
    const result = await f.search({ discovery: { timeRange, sortBy: 'general' } });
    assert.deepEqual(f.calls.map(c => c.body), [{ keyword: '主题', offset: 0, sortType: '_2', exactMatch: false }]);
    assert.equal(result.cost.requests, 1); assert.equal(result.cost.estimatedCny, .04);
    assert.equal(result.items.length, 0); assert.equal(result.pendingReferences.length, 1);
  }
  for (const [sortBy, expected] of [['general', '_0'], ['likes', '_4'], ['favorites', '_4']]) {
    const f = fixture(() => ({ list: [] }));
    await f.search({ discovery: { timeRange: 'all', sortBy } });
    assert.equal(f.calls[0].body.sortType, expected);
  }
});

test('title-only rows stay as clues and malformed or duplicate rows appear in safe statistics', async () => {
  const f = fixture(() => ({ list: [row(1, { workDesc: '' }), row(1, { workDesc: '' }), null, row(2, { workPublishTime: 'raw-private-time' }), row(3)] }));
  const result = await f.search();
  assert.equal(f.calls.length, 1); assert.equal(result.items.length, 1); assert.equal(result.pendingReferences.length, 2);
  assert.deepEqual(result.reports[0].stats, { rawCount: 5, normalizedCount: 4, invalidCount: 1, duplicateCount: 1, missingDateCount: 1, emptyContentCount: 1, searchRequests: 1, detailRequests: 0 });
  assert.equal(result.reports[0].count, 1);
  assert.match(result.pendingReferences[0].reason, /正文/);
  assert.match(result.pendingReferences[1].reason, /发布时间/);
  assert.ok(!JSON.stringify(result).includes('raw-private-time'));
});

test('three keywords have six bounded search calls and at most three detail calls for the entire run', async () => {
  let index = 0, activeChecks = 0;
  const f = fixture((operation, body) => operation === 'social.search.xiaohongshu'
    ? { list: [row(++index, { workDesc: '', workPublishTime: '' })], hasMore: true }
    : row(Number.parseInt(body.workId, 16)));
  const result = await f.search({ queries: ['主题一', '主题二', '主题三'], redfoxXhsExpansion: true, assertActive: () => activeChecks++ });
  assert.equal(f.calls.length, 9); assert.equal(activeChecks, 18);
  assert.deepEqual(f.calls.filter(c => c.operation.includes('.search.')).map(c => c.body.offset), [0, 20, 0, 20, 0, 20]);
  assert.equal(f.calls.filter(c => c.operation.includes('.detail.')).length, 3);
  assert.equal(result.items.length, 3); assert.equal(result.pendingReferences.length, 3);
  assert.deepEqual(result.cost, { requests: 9, estimatedCny: .36 });
  assert.equal(result.reports.reduce((n, r) => n + r.stats.detailRequests, 0), 3);
  assert.ok(f.calls.every(c => c.context.projectId === 'p' && c.context.platform === 'xiaohongshu' && !c.context.accountId));
});

test('detail enrichment fills missing evidence but spends nothing on known expired candidates', async () => {
  const initial = [row(1, { workDesc: '', workPublishTime: '2025-01-01 12:00:00' }), row(2, { workDesc: '' }), row(3, { workPublishTime: '' }), row(4, { workPublishTime: '2025-01-01 12:00:00' })];
  const f = fixture((operation, body) => operation.includes('.search.') ? { list: initial, hasMore: false }
    : body.workId === workId(2) ? row(2, { workPublishTime: '昨天' }) : row(3, { workDesc: '' }));
  const result = await f.search({ redfoxXhsExpansion: true });
  assert.deepEqual(f.calls.map(c => c.body.workId).filter(Boolean), [workId(2), workId(3)]);
  assert.equal(result.items.length, 3); assert.equal(result.pendingReferences.length, 1);
  assert.equal(result.reports[0].stats.emptyContentCount, 1);
  assert.equal(result.reports[0].stats.missingDateCount, 0);
  assert.equal(result.items.find(r => r.itemId === workId(2)).publishedAt, '2026-01-09T04:00:00.000Z');
  assert.equal(result.items.find(r => r.itemId === workId(3)).text, initial[2].workDesc);
  const cleaned = cleanReferences(result.items, { at, discovery: input.discovery });
  assert.equal(cleaned.references.length, 2); assert.equal(cleaned.excluded.expired, 1);
  assert.deepEqual(result.cost, { requests: 3, estimatedCny: .12 });
});

test('empty, fully repeated and provider final pages stop paging without retrying', async () => {
  for (const response of [{ list: [] }, { list: [row(1)], hasMore: false }]) {
    const f = fixture(() => response); await f.search({ redfoxXhsExpansion: true }); assert.equal(f.calls.length, 1);
  }
  const repeated = fixture(() => ({ list: [row(1)], hasMore: true }));
  const result = await repeated.search({ queries: ['主题一', '主题二'], redfoxXhsExpansion: true });
  assert.equal(repeated.calls.length, 3);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.reports.map(r => r.stats.duplicateCount), [1, 1]);
  const malformed = fixture(() => ({ list: [null], hasMore: true }));
  const invalid = await malformed.search({ redfoxXhsExpansion: true });
  assert.equal(malformed.calls.length, 1); assert.equal(invalid.reports[0].stats.invalidCount, 1);
});

test('partial search success survives a later failure and no pending detail or later keyword is retried', async () => {
  const f = fixture((operation, body) => { if (body.offset === 20) throw Error('raw-private-upstream'); return { list: [row(1), row(2, { workDesc: '' })], hasMore: true }; });
  const result = await f.search({ queries: ['主题一', '主题二'], redfoxXhsExpansion: true });
  assert.equal(f.calls.length, 2); assert.equal(result.items.length, 1); assert.equal(result.pendingReferences.length, 1);
  assert.equal(result.reports.length, 1); assert.equal(result.reports[0].count, 1); assert.equal(result.reports[0].status, 'failed');
  assert.equal(result.reports[0].stats.searchRequests, 2); assert.equal(result.reports[0].stats.detailRequests, 0);
  assert.ok(!JSON.stringify(result).includes('raw-private-upstream'));
  assert.deepEqual(result.cost, { requests: 2, estimatedCny: .08 });
});

test('incompatible search response is distinguishable from an empty successful result', async () => {
  const f = fixture(() => ({ list: { private: 'not-a-list' } }));
  const result = await f.search({ queries: ['主题一', '主题二'], redfoxXhsExpansion: true });
  assert.equal(f.calls.length, 1); assert.equal(result.reports[0].status, 'failed');
  assert.equal(result.reports[0].stats.invalidCount, 1); assert.equal(result.reports[0].stats.rawCount, 0);
  assert.ok(!JSON.stringify(result).includes('not-a-list'));
});

test('detail objects must identify the same work before any search evidence is merged', async () => {
  for (const detail of [row(999), { workDesc: 'other-private-body', workPublishTime: '2026-01-09 12:00:00' }, [row(1)], { data: row(1) }]) {
    const f = fixture(operation => operation.includes('.search.') ? { list: [row(1, { workDesc: '' }), row(2), row(3, { workDesc: '' })], hasMore: false } : detail);
    const result = await f.search({ redfoxXhsExpansion: true });
    assert.equal(f.calls.length, 2); assert.equal(result.items.length, 1); assert.equal(result.items[0].itemId, workId(2));
    assert.equal(result.pendingReferences.length, 2); assert.equal(result.reports[0].status, 'failed');
    assert.equal(result.reports[0].stats.invalidCount, 1); assert.equal(result.reports[0].stats.detailRequests, 1);
    assert.ok(!JSON.stringify(result).includes('other-private-body'));
  }
});

test('every paid request is checked for cancellation before and after, with no subsequent request', async () => {
  for (const [cancelAt, expectedCalls] of [[1, 0], [2, 1], [3, 1], [4, 2]]) {
    let checks = 0;
    const f = fixture(operation => operation.includes('.search.') ? { list: [row(1, { workDesc: '' })], hasMore: false } : row(1));
    await assert.rejects(f.search({ redfoxXhsExpansion: true, assertActive: () => { if (++checks >= cancelAt) throw Error('cancelled'); } }), /cancelled/);
    assert.equal(f.calls.length, expectedCalls);
  }
});

test('repeated trimmed keywords do not cause duplicate paid searches and expansion is explicit boolean', async () => {
  const f = fixture(() => ({ list: [] }));
  await f.search({ queries: ['主题', ' 主题 ', '主题'] });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.keyword, '主题');
  await assert.rejects(f.search({ redfoxXhsExpansion: 'true' }), /选项无效/);
  assert.equal(f.calls.length, 1);
});
