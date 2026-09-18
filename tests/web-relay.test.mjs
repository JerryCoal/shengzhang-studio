import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createWebRelay, allowedWebOperation } from '../server/web-relay.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';
import { seedState, makeDraft, confirmStrategy } from '../server/domain.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';

async function fixture(t, fetcher, extra = {}) {
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher }, ...extra }); root.use(app);
  t.after(async () => { const stopped = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await app.locals.close(); await stopped; });
  const request = async (payload, headers = {}) => {
    const response = await fetch(base + '/api/web/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, body: JSON.stringify(payload) });
    return { status: response.status, value: await response.json(), headers: response.headers };
  };
  return { request, base, app };
}
const envelope = (path, state = seedState(), credentials = { openai: 'sk-test-web-only-1234567890123456' }, body = {}) => ({ path, method: 'POST', body, state, credentials, routes: DEFAULT_ROUTES, authorizations: [] });

test('web relay returns Seedream frames to the browser without retaining or echoing its key', async t => {
  const key = 'seedream-browser-test-secret', calls = [];
  const f = await fixture(t, async (url, init) => { calls.push(url); assert.equal(init.headers.Authorization, `Bearer ${key}`); return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }], usage: { generated_images: 1 } }); });
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  const a = p.assets.find(v => v.kind === 'video');
  const input = { ...envelope(`/projects/${p.id}/assets/${a.id}/keyframes`, state, { seedream: key }, { provider: 'seedream', role: 'first_frame', prompt: 'portrait', expectedRevision: a.revision }), seedream: defaultSeedream };
  const r = await f.request(input); assert.equal(r.status, 200); assert.equal(r.value.status, 202);
  assert.equal(r.value.state.projects[0].assets.find(v => v.id === a.id).aiProduction.frames[0].provider, 'seedream');
  assert(!JSON.stringify(r.value).includes(key)); assert.deepEqual(r.value.credentials, {});
  const missing = await f.request({ ...input, credentials: {} }); assert.equal(missing.value.status, 400); assert.equal(calls.length, 1);
});

test('split hosting permits only the configured frontend and retrieves long jobs with a private ticket', async t => {
  let complete, calls = 0;
  const f = await fixture(t, async () => { calls++; await new Promise(resolve => { complete = resolve; }); return Response.json({ data: [{ id: 'gpt-5.4' }] }); }, { frontendOrigins: ['https://jerrycoal.github.io'] });
  const headers = { Origin: 'https://jerrycoal.github.io', 'X-Studio-Client': 'studio-v1' };
  const endpoint = f.base + '/api/web/jobs';
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,X-Studio-Client' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), headers.Origin);
  assert.equal((await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } })).status, 403);
  const input = envelope('/settings/credential/check');
  const submission = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(submission.status, 202); const { job } = await submission.json(); assert.match(job, /^[a-f0-9]{64}$/);
  assert.equal((await fetch(endpoint, { headers })).status, 404);
  assert.equal((await fetch(endpoint, { headers: { ...headers, Authorization: 'Bearer ' + 'a'.repeat(64) } })).status, 404);
  const ticketHeaders = { ...headers, Authorization: `Bearer ${job}` };
  assert.equal((await fetch(endpoint, { headers: ticketHeaders })).status, 202);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, 429);
  complete();
  let result;
  for (let attempt = 0; attempt < 30; attempt++) { result = await fetch(endpoint, { headers: ticketHeaders }); if (result.status !== 202) break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(result.status, 200); const value = await result.json(); assert.equal(value.status, 200); assert.equal(value.response.verification.models[0].available, true); assert.equal(calls, 1);
  assert(!JSON.stringify(value).includes(input.credentials.openai));
  assert.equal((await fetch(endpoint, { method: 'DELETE', headers: ticketHeaders })).status, 200);
  assert.equal((await fetch(endpoint, { headers: ticketHeaders })).status, 404);
});

test('web relay keeps each operation isolated, uses only its supplied key, and rejects server workspace APIs', async t => {
  const requests = [];
  const f = await fixture(t, async (url, init) => {
    requests.push({ url, key: init.headers.Authorization });
    return Response.json({ data: [{ id: 'gpt-5.4' }] });
  });
  const a = envelope('/settings/credential/check', { ...seedState(), projects: [], activities: [] });
  const result = await f.request(a);
  assert.equal(result.status, 200); assert.equal(result.value.status, 200);
  assert.equal(result.value.response.verification.models[0].available, true);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert(!JSON.stringify(result.value).includes(a.credentials.openai));
  const missing = await f.request({ ...a, credentials: {} });
  assert.equal(missing.value.status, 400); assert.equal(requests.length, 1);
  const b = await f.request({ ...a, credentials: { openai: 'sk-second-user-only-1234567890123' } });
  assert.equal(b.value.status, 200); assert.equal(requests[1].key, 'Bearer sk-second-user-only-1234567890123');
  for (const path of ['/state', '/profiles/remembered', '/profiles/register', '/backup']) assert.equal((await fetch(f.base + '/api' + path)).status, 404);
  const health = await (await fetch(f.base + '/api/health')).json();
  assert.equal(health.serverStoresWorkspaces, false);
});

test('web relay validates origins, routes, payloads and project ownership before upstream calls', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return Response.json({}); });
  const input = envelope('/settings/credential/check');
  assert.equal((await f.request(input, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request(input, { 'X-Studio-Client': '' })).status, 403);
  assert.equal((await f.request({ ...input, path: 'https://evil.example/' })).status, 404);
  assert.equal((await f.request({ ...input, path: '/projects/missing/strategies' })).status, 400);
  assert.equal((await f.request({ ...input, state: { ...input.state, webPrivate: { credentials: {} } } })).status, 400);
  assert.equal((await f.request({ ...input, state: { ...input.state, projects: [input.state.projects[0], input.state.projects[0]] } })).status, 400);
  assert.equal(calls, 0);
  assert(!allowedWebOperation('/projects/a/export', 'POST'));
  assert(!allowedWebOperation('/integrations/douyin/authorize', 'GET'));
  assert.throws(() => createWebRelay({ publicOrigin: 'http://studio.example' }), /HTTPS/);
});

test('web AI returns corpus references, sensitive replacements and usage for local persistence', async t => {
  let prompt;
  const f = await fixture(t, async (_url, init) => {
    prompt = JSON.parse(init.body);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: '便携咖啡计划', core: '全球第一的咖啡', direction: '使用真实产品资料', prompt: '拍摄真实咖啡包装' }) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
  });
  const state = seedState(); state.contentRules = [{ id: 'custom', term: '全球第一', replacement: '适合户外', enabled: true }];
  const p = state.projects[0];
  p.corpus = [{ id: 'doc', name: '咖啡说明.txt', text: '便携咖啡是挂耳咖啡，适合露营使用。', format: 'txt', enabled: true, chunks: [{ index: 0, text: '便携咖啡是挂耳咖啡，适合露营使用。' }], importedAt: new Date().toISOString() }];
  const result = await f.request(envelope(`/projects/${p.id}/strategies`, state, undefined, { mode: 'openai', query: '便携咖啡' }));
  assert.equal(result.status, 200); assert.equal(result.value.status, 200);
  const output = result.value.state.projects[0];
  const strategy = output.strategies.at(-1);
  assert.equal(strategy.core, '适合户外的咖啡'); assert(strategy.corpusReferences.length);
  assert.equal(output.usage.at(-1).status, 'completed'); assert.equal(prompt.store, false);
  assert(prompt.input.includes('咖啡说明.txt'));
  assert.equal(state.projects[0].strategies.length + 1, output.strategies.length);
});

test('web relay waits for keyframe completion and carries Seedance task state across independent requests', async t => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
  const f = await fixture(t, async url => {
    if (url.includes('/images/')) return Response.json({ data: [{ b64_json: png }], usage: { input_tokens_details: { text_tokens: 10, image_tokens: 0 }, output_tokens: 10 } });
    if (url.endsWith('/tasks')) return Response.json({ id: 'seedance-task-a' });
    return Response.json({ id: 'seedance-task-a', status: 'running' });
  });
  let state = seedState(), p = state.projects[0]; const draft = makeDraft(p); confirmStrategy(p, draft.id);
  let asset = p.assets.find(a => a.kind === 'video');
  const frame = await f.request(envelope(`/projects/${p.id}/assets/${asset.id}/keyframes`, state, undefined, { expectedRevision: asset.revision, role: 'first_frame', prompt: '真实咖啡产品', quality: 'low' }));
  assert.equal(frame.value.status, 202);
  state = frame.value.state; p = state.projects[0]; asset = p.assets.find(a => a.id === asset.id);
  assert.equal(asset.aiProduction.phase, 'frames'); assert.equal(asset.aiProduction.frames.length, 1);
  const last = await f.request(envelope(`/projects/${p.id}/assets/${asset.id}/keyframes`, state, undefined, { expectedRevision: asset.revision, role: 'last_frame', prompt: '真实咖啡产品尾帧', quality: 'low' }));
  state = last.value.state; asset = state.projects[0].assets.find(a => a.id === asset.id);
  const video = envelope(`/projects/${p.id}/assets/${asset.id}/seedance`, state, { seedance: 'seed-test-only-12345' }, { productionId: asset.aiProduction.id, confirmed: true, expectedRevision: asset.revision, prompt: '咖啡产品短片', duration: 5, generateAudio: false });
  video.seedance = { region: 'volcengine', model: 'ep-seed-test', reservationUsd: 2, outputPriceUsd: 0 };
  const submitted = await f.request(video);
  assert.equal(submitted.value.status, 202);
  const generated = submitted.value.state.projects[0].assets.find(a => a.id === asset.id);
  assert.equal(generated.aiProduction.taskId, 'seedance-task-a');
  const check = envelope(`/projects/${p.id}/assets/${asset.id}/video-status`, submitted.value.state, video.credentials); check.seedance = video.seedance;
  const polled = await f.request(check); assert.equal(polled.value.status, 200);
  assert.equal(polled.value.state.projects[0].assets.find(a => a.id === asset.id).aiProduction.phase, 'generating-video');
});

test('three-way result merge preserves concurrent autosave, other users projects and private keys', () => {
  const current = seedState(), base = structuredClone(current); base.activities = [];
  const remote = structuredClone(base), pid = base.projects[0].id;
  current.projects[0].brief.name = '用户刚刚改的名字'; current.projects[0].revision++;
  current.webPrivate = { credentials: { openai: 'private-key' } };
  current.projects.push({ ...structuredClone(current.projects[0]), id: 'second' });
  remote.projects[0].strategies.push({ id: 'generated', title: '在线策略' }); remote.projects[0].revision++;
  const merged = mergeRelayState(base, remote, current);
  assert.equal(merged.projects.find(p => p.id === pid).brief.name, '用户刚刚改的名字');
  assert.equal(merged.projects[0].strategies.at(-1).title, '在线策略'); assert.equal(merged.projects.length, 2);
  assert.equal(merged.webPrivate.credentials.openai, 'private-key');
  const conflict = structuredClone(remote); conflict.projects[0].brief.name = '另一个名字';
  assert.throws(() => mergeRelayState(base, conflict, current), /冲突/);
});
