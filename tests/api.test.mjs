import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import JSZip from 'jszip';
import * as domain from '../server/domain.mjs';

async function fixture(t, config = {}) {
  const store = createStore(':memory:'); const server = createApp(store, config).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, method = 'GET', body, headers = {}) => { const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  return { store, req, base, p: store.get().projects[0] };
}
test('API validates inputs and optimistic project revision', async t => {
  const { req, p } = await fixture(t); assert.equal((await req('/projects', 'POST', { name: '' })).status, 400);
  assert.equal((await req(`/projects/${p.id}`, 'PATCH', { brief: p.brief, expectedRevision: 0 })).status, 409);
  assert.equal((await req('/projects/missing', 'PATCH', {})).status, 404);
});
test('local app rejects third-party origins and missing client header', async t => {
  const { req, base } = await fixture(t); assert.equal((await req('/state', 'GET', undefined, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await fetch(`${base}/api/state`)).status, 403);
});
test('deployed workspace requires login and revokes tokens on logout', async t => {
  const { req } = await fixture(t, { password: 'test-workspace-password' });
  assert.equal((await req('/state')).status, 401); assert.equal((await req('/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await req('/login', 'POST', { password: 'test-workspace-password' }); assert.equal(login.status, 200);
  const headers = { Authorization: `Bearer ${login.data.token}` }; assert.equal((await req('/state', 'GET', undefined, headers)).status, 200);
  await req('/logout', 'POST', {}, headers); assert.equal((await req('/state', 'GET', undefined, headers)).status, 401);
});
test('configured key is never returned in settings, state or backup', async t => {
  const { req } = await fixture(t, { apiKey: 'private-test-key' });
  for (const path of ['/settings', '/state', '/backup']) assert.doesNotMatch(JSON.stringify((await req(path)).data), /private-test-key/);
});
test('budget rejects expensive requests before contacting OpenAI', async t => {
  let called = false; const { req, store, p } = await fixture(t, { apiKey: 'test', fetcher: () => { called = true; throw new Error(); } });
  store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  const response = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }); assert.equal(response.status, 400); assert.equal(called, false); assert.equal(store.get().projects[0].usage.length, 0);
});
test('strategy route uses structured output, records model-specific usage and keeps key server-side', async t => {
  let requestBody; const strategy = { title: '测试主题', core: '测试核心', direction: '测试方向', prompt: '仅使用真实资料' };
  const { req, store, p } = await fixture(t, { apiKey: 'test', fetcher: async (_url, init) => { requestBody = JSON.parse(init.body); return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(strategy) }] }], usage: { input_tokens: 100, output_tokens: 200 } }); } });
  const response = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }); assert.equal(response.status, 200);
  assert.equal(requestBody.model, 'gpt-5.4'); assert.equal(requestBody.store, false); assert.equal(requestBody.text.format.strict, true);
  const saved = store.get().projects[0]; assert.equal(saved.strategies.at(-1).source, 'openai'); assert.equal(saved.strategies.at(-1).model, 'gpt-5.4'); assert.equal(saved.usage[0].status, 'completed'); assert.equal(saved.usage[0].amountUsd, 0.00325);
});
test('uncertain API failure preserves reserved budget and existing strategy', async t => {
  const { req, store, p } = await fixture(t, { apiKey: 'test', fetcher: async () => { throw new Error('connection lost'); } });
  assert.equal((await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 502);
  const after = store.get().projects[0]; assert.equal(after.strategies.length, 1); assert.equal(after.usage[0].status, 'uncertain'); assert.ok(after.usage[0].amountUsd > 0);
});
test('explicit API rejection releases reservation without silently using local mode', async t => {
  const { req, store, p } = await fixture(t, { apiKey: 'test', fetcher: async () => new Response('{}', { status: 401 }) });
  assert.equal((await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 502);
  const after = store.get().projects[0]; assert.equal(after.strategies.length, 1); assert.equal(after.usage[0].amountUsd, 0); assert.equal(after.usage[0].status, 'failed');
});
test('full API feedback loop preserves sample provenance and selected experience', async t => {
  const { req, p } = await fixture(t);
  const sample = await req(`/projects/${p.id}/comments/sample`, 'POST', {}); assert.equal(sample.status, 200); assert.equal(sample.data.result.added, 10);
  assert.equal((await req(`/projects/${p.id}/comments/sample`, 'POST', {})).data.result.added, 0);
  const analysis = await req(`/projects/${p.id}/analysis`, 'POST', {}); assert.equal(analysis.status, 200); const insight = analysis.data.result.find(i => i.category === '使用疑问');
  await req(`/projects/${p.id}/insights/${insight.id}`, 'PATCH', { status: 'adopted' });
  const next = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'demo' }); assert.equal(next.status, 200); assert.match(next.data.result.prompt, /实物比例/); assert.equal(next.data.state.projects[0].comments.every(c => c.sample), true);
});

test('new project creation persists every editable brief field', async t => {
  const { req, p } = await fixture(t);
  const brief = { ...p.brief, name: '测试新品项目', brand: '测试品牌', product: '旅行杯', facts: '容量 350ml，材质待补充', channels: ['douyin'] };
  const created = await req('/projects', 'POST', brief); assert.equal(created.status, 201); assert.equal(created.data.result.sample, false);
  const saved = (await req('/state')).data.projects.find(x => x.id === created.data.result.id); assert.deepEqual(saved.brief, brief);
});

test('authenticated export creates a downloadable ZIP with the exact saved version', async t => {
  const { req, base, store, p } = await fixture(t);
  const asset = store.mutate(state => {
    const saved = state.projects[0]; domain.confirmStrategy(saved, saved.strategies[0].id); const a = saved.assets[0];
    return domain.updateAsset(saved, a.id, { title: a.title, body: '已保存正文', expectedRevision: a.revision, mime: 'image/png', mediaData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=' });
  });
  const prepared = await req(`/projects/${p.id}/export`, 'POST', { kind: 'asset', id: asset.id }); assert.equal(prepared.status, 200);
  const response = await fetch(base + prepared.data.url); assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /attachment/); assert.equal(response.headers.get('cache-control'), 'no-store');
  const zip = await JSZip.loadAsync(await response.arrayBuffer()); assert.ok(zip.file('素材.png')); assert.match(await zip.file('标题与正文.txt').async('string'), /已保存正文/);
  assert.equal((await fetch(base + '/downloads/unknown')).status, 404);
});

test('concurrent GPT request is rejected; stale result records cost but cannot overwrite new brief', async t => {
  let finish, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const responsePromise = new Promise(resolve => { finish = resolve; });
  const { req, store, p } = await fixture(t, { apiKey: 'test', fetcher: async () => { entered(); return responsePromise; } });
  const pending = req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }); await enteredPromise;
  assert.equal((await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 409);
  const current = store.get().projects[0]; const brief = { ...current.brief, name: '更新后的真实项目' };
  assert.equal((await req(`/projects/${p.id}`, 'PATCH', { brief, expectedRevision: current.revision })).status, 200);
  finish(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: '旧结果', core: '旧核心', direction: '旧方向', prompt: '旧要求' }) }] }], usage: { input_tokens: 100, output_tokens: 100 } }));
  assert.equal((await pending).status, 409); const saved = store.get().projects[0]; assert.equal(saved.brief.name, brief.name); assert.equal(saved.strategies.length, 1); assert.equal(saved.usage[0].status, 'completed');
});
