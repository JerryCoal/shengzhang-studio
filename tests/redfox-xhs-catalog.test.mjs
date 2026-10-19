import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { redfoxXhsCatalog } from '../server/redfox-xhs-catalog.mjs';
import { createRedfoxService } from '../server/redfox-client.mjs';
import { mountIntegrations, createIntegrationPreferences } from '../server/integrations.mjs';
import { createStore } from '../server/store.mjs';

const secret = 'synthetic-xhs-samples-key-never-real';
const query = { keyword: '校园学习', pageNum: 1, pageSize: 50, startDate: '2026-10-11', endDate: '2026-10-17' };
const example = { articles: [{ id: '6a4dcb110000000016025b73', title: '样本标题', desc: '仅模拟公开样本。', cover: 'https://sns-img-qc.xhscdn.com/synthetic.jpg', createTime: '2026-10-16 13:05:29', likedCount: 629, collectedCount: 1120, commentsCount: 26, sharedCount: 228, interactiveCount: 1775, authorId: '66b81a14000000001d020e53', authorNickname: '模拟作者', authorFans: 8614, shareInfoLink: 'https://www.xiaohongshu.com/explore/6a4dcb110000000016025b73' }], latestHotArticles: [{ id: 'unrelated-fallback', title: '无关兜底内容' }], total: 1, pageNum: 1, pageSize: 50, keyword: query.keyword, tips: '相关结果较少', hotTopics: [], relatedSearches: [] };
function fixture(fetcher) {
  const state = { projects: [] }, store = { get: () => structuredClone(state), mutate: work => work(state) };
  const config = { redfoxVault: { status: () => ({ configured: true, supported: true }), getKey: async () => secret }, redfoxFetcher: fetcher };
  const prefs = { get: () => ({ redfox: { enabled: true } }) };
  return { state, store, config, service: createRedfoxService(store, config, prefs, redfoxXhsCatalog) };
}

test('XHS sample operation is a fixed, frozen documented endpoint with one CNY base price', () => {
  assert.deepEqual(Object.keys(redfoxXhsCatalog), ['xhs.samples']);
  assert.deepEqual(redfoxXhsCatalog['xhs.samples'], { path: '/story/api/xhs/search/search', method: 'POST', priceCny: .06, kind: 'data', label: '小红书爆款笔记样本', interfaceNo: '3X8FGEEM' });
  assert(Object.isFrozen(redfoxXhsCatalog)); assert(Object.isFrozen(redfoxXhsCatalog['xhs.samples']));
  assert.throws(() => { redfoxXhsCatalog['xhs.samples'].path = '/story/api/skill/record/save'; });
});

test('XHS sample read sends one bounded operation, keeps fallback separate and records account/project ownership', async () => {
  let calls = 0;
  const f = fixture(async (url, init) => {
    calls++; assert.equal(url, 'https://redfox.hk/story/api/xhs/search/search'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.REDFOX_API_KEY, secret); assert.deepEqual(JSON.parse(init.body), query);
    return Response.json({ code: 2000, data: example, msg: '成功' });
  });
  const result = await f.service.request('xhs.samples', query, { projectId: 'project-one', accountId: 'xhs-account-one', platform: 'xiaohongshu', stage: 'xhs-samples' });
  assert.deepEqual(result, example); assert.equal(calls, 1);
  assert.equal(result.articles.length, 1); assert.equal(result.latestHotArticles[0].title, '无关兜底内容');
  assert.equal(f.state.redfoxUsage.length, 1); const row = f.state.redfoxUsage[0];
  assert.equal(row.amountCny, .06); assert.equal(row.amountUsd, undefined); assert.equal(row.status, 'completed'); assert.equal(row.projectId, 'project-one'); assert.equal(row.accountId, 'xhs-account-one');
  assert(!JSON.stringify(f.state).includes(secret)); assert(!JSON.stringify(f.state).includes(query.keyword));
});

test('XHS sample failure never retries or silently invokes the older combined API', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Error('timeout'); });
  await assert.rejects(f.service.request('xhs.samples', query), /没有自动重复/);
  assert.equal(calls, 1); assert.equal(f.state.redfoxUsage[0].status, 'uncertain'); assert.equal(f.state.redfoxUsage[0].amountCny, .06);
  await assert.rejects(f.service.request('getXhsCozeSkillData', query), /尚未接入/); assert.equal(calls, 1);
});

test('application integration registers XHS sample operation in the existing encrypted-credential client', async t => {
  const store = createStore(':memory:'); let calls = 0;
  const preferences = createIntegrationPreferences(); preferences.saveRedfox({ enabled: true });
  const config = { integrationPreferences: preferences, redfoxVault: { status: () => ({ configured: true, supported: true }), getKey: async () => secret }, redfoxFetcher: async (url, init) => { calls++; assert.equal(url, 'https://redfox.hk/story/api/xhs/search/search'); assert.equal(init.headers.REDFOX_API_KEY, secret); return Response.json({ code: 2000, data: example }); } };
  const mounted = mountIntegrations(express(), store, config, { project: (state, id) => state.projects.find(item => item.id === id), mutate: () => {}, activeJobs: new Set() });
  t.after(async () => { await mounted.close(); store.close(); });
  assert.equal(config.redfox.enabled('data'), true);
  const result = await config.redfox.request('xhs.samples', query);
  assert.equal(calls, 1); assert.equal(result.articles[0].id, example.articles[0].id);
});
