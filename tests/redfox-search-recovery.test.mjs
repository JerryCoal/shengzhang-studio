import test from 'node:test';
import assert from 'node:assert/strict';
import { searchRedfoxWeb } from '../server/redfox-search.mjs';
function fixture(job) {
  const state = { projects: [{ id: 'p', revision: 1, ...(job ? { redfoxWebSearch: job } : {}) }] };
  const store = { get: () => structuredClone(state), mutate: fn => fn(state) };
  return { state, store };
}
test('restart between paid search submission and task-id save cannot automatically submit again', async () => {
  const f = fixture({ id: 'before-crash', status: 'submitting' }); let calls = 0;
  const config = { redfox: { enabled: () => true, request: async () => { calls++; } } };
  await assert.rejects(searchRedfoxWeb(f.store, config, { projectId: 'p', queries: ['original'] }), /提交结果不明/);
  assert.equal(calls, 0); assert.equal(f.state.projects[0].redfoxWebSearch.id, 'before-crash');
});
test('search caches bounded references only, excludes AI answers and reuses completed task', async () => {
  const f = fixture(); let submits = 0;
  const config = { redfoxSearchPollRounds: 1, redfox: { enabled: () => true, request: async op => {
    if (op === 'search.submit') { submits++; return { taskId: 'existing-id' }; }
    return { completed: true, result: { content: 'AI_ANSWER_NOT_EVIDENCE', webPages: [{ title: 'Headline', url: 'https://example.com/story?api_key=drop', snippet: 'Text'.repeat(1000), arbitrarySecret: 'NEVER_CACHE_THIS', publishTime: null }] } };
  } }, researchPageResolver: async () => [{ address: '127.0.0.1', family: 4 }] };
  for (let i = 0; i < 2; i++) {
    const output = await searchRedfoxWeb(f.store, config, { projectId: 'p', queries: ['original'] });
    assert.equal(output.items[0].publishedAt, ''); assert.equal(output.items[0].text, '');
  }
  assert.equal(submits, 1);
  const saved = JSON.stringify(f.state); assert.doesNotMatch(saved, /AI_ANSWER|NEVER_CACHE|api_key/);
  assert.equal(f.state.projects[0].redfoxWebSearch.result.result.webPages[0].snippet.length, 1200);
});
test('optional response task ID cannot replace the requested search job', async () => {
  const f = fixture(); let submits = 0;
  const config = { redfoxSearchPollRounds: 1, redfox: { enabled: () => true, request: async op => {
    if (op === 'search.submit') { submits++; return { taskId: 'original-id' }; }
    return { taskId: 'wrong-id', completed: true, result: { webPages: [] } };
  } } };
  for (let i = 0; i < 2; i++) await assert.rejects(searchRedfoxWeb(f.store, config, { projectId: 'p', queries: ['original'] }), /编号不匹配/);
  assert.equal(submits, 1); assert.equal(f.state.projects[0].redfoxWebSearch.status, 'pending');
});
