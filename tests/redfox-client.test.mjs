import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedfoxService } from '../server/redfox-client.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { redfoxWebReferences, searchRedfoxWeb } from '../server/redfox-search.mjs';
import { normalizeRedfoxHotspots } from '../server/redfox-trends.mjs';

const secret = 'synthetic-redfox-test-key-never-real';
function fixture(fetcher, state = { projects: [] }) {
  const store = { get: () => structuredClone(state), mutate: work => work(state) };
  const config = { redfoxVault: { status: () => ({ configured: true, supported: true, suffix: 'real' }), getKey: async () => secret }, redfoxFetcher: fetcher };
  const prefs = { get: () => ({ redfox: { enabled: true, mediaEnabled: true, searchEnabled: true } }) };
  const service = createRedfoxService(store, config, prefs, { 'test.read': { path: '/story/api/test/read', priceCny: .06 }, 'test.upload': { path: '/story/api/test/upload', priceCny: 0, multipart: true, queryKeys: ['format'] } });
  return { service, store, config, state };
}
test('Redfox credentials stay at fixed HTTPS origin, redirects disabled; ledger is CNY and actor-scoped', async () => {
  let calls = 0;
  const f = fixture(async (url, init) => { calls++; assert.equal(url, 'https://redfox.hk/story/api/test/read'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.REDFOX_API_KEY, secret); return Response.json({ code: 2000, data: { list: [] } }); });
  assert.equal(f.service.status().verifiedAt, null);
  const data = await runWithActor({ userId: 'author', username: '测试成员', role: 'editor' }, () => f.service.request('test.read', { keyword: 'public topic' }, { projectId: 'p1', accountId: 'a1', platform: 'youtube' }));
  assert.deepEqual(data, { list: [] }); assert.equal(calls, 1);
  const row = f.state.redfoxUsage[0]; assert.equal(row.actor.userId, 'author'); assert.equal(row.accountId, 'a1'); assert.equal(row.amountCny, .06); assert.equal(row.status, 'completed'); assert.equal(row.amountUsd, undefined);
  assert(!JSON.stringify(f.state).includes(secret)); assert(!JSON.stringify(f.state).includes('public topic')); assert(f.service.status().verifiedAt);
  await assert.rejects(f.service.request('https://evil.test', {}), /尚未接入/); assert.equal(calls, 1);
});
test('Redfox business errors and timeouts keep uncertain cost without leaking upstream content or retrying', async () => {
  for (const fetcher of [async () => Response.json({ code: 3201, msg: secret, data: null }), async () => { throw Error(secret); }, async () => Response.json({ code: 2000 })]) {
    let calls = 0; const f = fixture(async (...args) => { calls++; return fetcher(...args); });
    await assert.rejects(f.service.request('test.read', {}), error => error.status === 502 && !error.message.includes(secret));
    assert.equal(calls, 1); assert.equal(f.state.redfoxUsage[0].status, 'uncertain'); assert.equal(f.state.redfoxUsage[0].amountCny, .06); assert(!JSON.stringify(f.state).includes(secret));
  }
});
test('Redfox multipart follows official query field convention without a JSON content type', async () => {
  const f = fixture(async (url, init) => { assert.equal(url, 'https://redfox.hk/story/api/test/upload?format=png'); assert.equal(init.headers['Content-Type'], undefined); assert(init.body instanceof FormData); return Response.json({ code: 2000, data: { url: 'https://redfox-hk.oss-cn-hangzhou.aliyuncs.com/test.png' } }); });
  const body = new FormData(); body.set('file', new Blob(['fixture']), 'fixture.png'); body.set('format', 'png'); await f.service.request('test.upload', body); assert.equal(f.state.redfoxUsage[0].amountCny, 0);
});
test('Redfox web references preserve missing dates and reject unsafe URLs; generated answers are not evidence', () => {
  const items = redfoxWebReferences({ result: { content: 'Invented answer', webPages: [{ title: 'Original', url: 'https://example.com/story?api_key=secret', snippet: 'Excerpt', publishTime: null }, { title: 'Unsafe', url: 'http://127.0.0.1/secret' }] } });
  assert.equal(items.length, 1); assert.equal(items[0].publishedAt, null); assert.equal(items[0].url, 'https://example.com/story'); assert(!JSON.stringify(items).includes('Invented'));
});
test('pending Redfox web searches resume the same task and never resubmit after timeout', async () => {
  const f = fixture(null, { projects: [{ id: 'p', revision: 1 }] }); let submits = 0, polls = 0;
  f.config.redfox = { enabled: () => true, request: async op => { if (op === 'search.submit') { submits++; return { taskId: 'same-task' }; } polls++; return { completed: false, status: 'processing' }; } };
  f.config.redfoxSearchPollRounds = 1;
  for (let i = 0; i < 2; i++) await assert.rejects(searchRedfoxWeb(f.store, f.config, { projectId: 'p', queries: ['topic'] }), /仍在处理/);
  assert.equal(submits, 1); assert.equal(polls, 2); assert.equal(f.state.projects[0].redfoxWebSearch.taskId, 'same-task');
  await assert.rejects(searchRedfoxWeb(f.store, f.config, { projectId: 'p', queries: ['other'] }), /原关键词/); assert.equal(submits, 1);
});
test('Redfox hot rankings stay separate from article publication dates and cross-platform aggregates', () => {
  const items = normalizeRedfoxHotspots([{ keyword: '校园', hotSpotList: [{ title: '校园故事', url: 'https://www.douyin.com/hot/1', platName: '抖音', latestRankDate: '2026-10-17 12:00:00', maxPosition: 5, maxHotScore: 800 }, { title: '校园活动', url: 'https://www.weibo.com/hot/1', platName: '微博', latestRankDate: 'unknown' }] }]);
  assert.equal(items.length, 2); assert.equal(items[0].rankedAt, '2026-10-17T04:00:00.000Z'); assert.equal(items[0].publishedAt, undefined); assert.equal(items[1].heat, null); assert.equal(items[1].rankedAt, null);
});
