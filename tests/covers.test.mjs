import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import JSZip from 'jszip';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';
import { confirmStrategy, updateAsset } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';

const key = 'seedream-cover-test-only-secret';
const png = 'data:image/png;base64,iVBORw0KGgo=';
const jpg = Buffer.from('ffd8ffe000044a46ffd9', 'hex').toString('base64');
const input = revision => ({ expectedRevision: revision, prompt: '顶级产品外观，背景简洁', query: '产品外观', style: 'clean', layout: 'top', textMode: 'title', confirmed: true });
async function fixture(t, fetcher) {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences(); preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: .04 });
  store.mutate(state => { const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.imageData = png; const a = p.assets.find(a => a.kind === 'image'); updateAsset(p, a.id, { title: a.title, body: a.body, mediaData: png, mime: 'image/png', expectedRevision: a.revision }); importCorpus(p, { name: '已核实的包装介绍', text: '产品外观为米白色独立包装，绿色品牌标识。' }); p.brief.facts = '后来修改但尚未用于此策略的事实'; });
  const app = createApp(store, { seedreamVault: { status: () => ({ configured: true, supported: true }), getKey: async () => key }, integrationPreferences: preferences, fetcher });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await app.locals.integrations.close(); await new Promise(r => server.close(r)); store.close(); });
  const p = () => store.get().projects[0], a = () => p().assets.find(a => a.kind === 'image');
  const path = `/projects/${p().id}/assets/${a().id}`;
  const request = async (path, body, method = 'POST') => { const response = await fetch(url + '/api' + path, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  return { app, store, p, a, path, request, url };
}
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Cover task did not finish'); }

test('Seedream cover is 3:4, grounded in confirmed facts, screened and adopted only on explicit approval; JPG export works', async t => {
  const calls = [];
  const f = await fixture(t, async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); });
  const old = f.a();
  assert.equal((await f.request(f.path + '/cover', input(old.revision))).status, 202);
  await until(() => f.a().aiCover?.phase === 'ready');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.size, '1728x2304'); assert.deepEqual(payload.image, [png]); assert.equal(payload.watermark, true);
  assert.match(payload.prompt, /已核实的包装介绍/); assert.doesNotMatch(payload.prompt, /后来修改但尚未/); assert.doesNotMatch(payload.prompt, /顶级/);
  assert.equal(f.a().mediaData, old.mediaData); assert.equal(f.a().revision, old.revision); assert.equal(f.a().history.length, old.history.length);
  assert.equal(f.p().usage.at(-1).amountUsd, .04); assert.equal(f.a().aiCover.corpusReferences[0].name, '已核实的包装介绍');
  const applied = await f.request(f.path + '/cover-apply', { id: f.a().aiCover.id, expectedRevision: old.revision, confirmed: true });
  assert.equal(applied.status, 200); assert.equal(f.a().mime, 'image/jpeg'); assert.equal(f.a().history[0].mediaData, old.mediaData);
  assert.equal(f.a().aiCover.phase, 'applied'); assert.equal(f.a().aiCover.mediaData, undefined);
  assert.equal((await f.request(f.path + '/cover-apply', { id: f.a().aiCover.id, expectedRevision: f.a().revision, confirmed: true })).status, 409);
  const exported = await f.request(`/projects/${f.p().id}/export`, { kind: 'asset', id: f.a().id });
  assert.equal(exported.status, 200); const download = await fetch(f.url + exported.body.url);
  const zip = await JSZip.loadAsync(await download.arrayBuffer()); assert(zip.file('素材.jpg'));
  assert(!JSON.stringify((await f.request('/backup', undefined, 'GET')).body).includes(key));
});

test('cover budget, revision, kind and explicit confirmation reject before paid dispatch', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return Response.json({}); });
  assert.equal((await f.request(f.path + '/cover', { ...input(f.a().revision), confirmed: false })).status, 400);
  assert.equal((await f.request(f.path + '/cover', input(0))).status, 400);
  assert.equal((await f.request(f.path + '/cover', input(999))).status, 409);
  const video = f.p().assets.find(a => a.kind === 'video');
  assert.equal((await f.request(`/projects/${f.p().id}/assets/${video.id}/cover`, input(video.revision))).status, 404);
  f.store.mutate(s => { s.projects[0].brief.budgetUsd = 0; });
  assert.equal((await f.request(f.path + '/cover', input(f.a().revision))).status, 400);
  assert.equal(calls, 0); assert.equal(f.p().usage.length, 0); assert.equal(f.a().aiCover, undefined);
});

test('in-flight cover rejects duplicate requests and stale results cannot overwrite edits', async t => {
  let done, calls = 0; const wait = new Promise(r => { done = r; });
  const f = await fixture(t, async () => { calls++; await wait; return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); });
  try {
    await f.request(f.path + '/cover', input(f.a().revision));
    assert.equal((await f.request(f.path + '/cover', input(f.a().revision))).status, 409);
    assert.equal((await f.request('/integrations/seedream', undefined, 'DELETE')).status, 409);
    f.store.mutate(s => { const p = s.projects[0], a = p.assets[0]; updateAsset(p, a.id, { title: a.title, body: '修改后的正文', expectedRevision: a.revision }); });
  } finally { done(); }
  await until(() => f.a().aiCover?.phase === 'stale');
  assert.equal(calls, 1); assert.equal(f.a().body, '修改后的正文'); assert.equal(f.a().mediaData, png);
  assert.equal((await f.request(f.path + '/cover-apply', { id: f.a().aiCover.id, expectedRevision: f.a().revision, confirmed: true })).status, 409);
});

test('uncertain cover preserves old result, reserves fees and stays locked across recovery', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; throw Error(key); });
  await f.request(f.path + '/cover', input(f.a().revision)); await until(() => f.a().aiCover?.phase === 'uncertain');
  assert.equal(f.a().mediaData, png); assert.equal(f.p().usage.at(-1).status, 'uncertain'); assert.equal(f.p().usage.at(-1).amountUsd, .1);
  assert.equal((await f.request(f.path + '/cover', input(f.a().revision))).status, 409); assert.equal(calls, 1);
  assert(!JSON.stringify(f.p()).includes(key));
  f.store.mutate(s => { s.projects[0].assets[0].aiCover.phase = 'generating'; });
  f.app.locals.integrations.start(); assert.equal(f.a().aiCover.phase, 'uncertain'); assert.equal(calls, 1);
  assert.equal((await f.request(f.path + '/cover-reset', { id: 'wrong', confirmed: true })).status, 409);
  assert.equal((await f.request(f.path + '/cover-reset', { id: f.a().aiCover.id, confirmed: true })).status, 200);
  assert.equal(calls, 1, 'unlocking cannot dispatch another request');
});

test('explicit Seedream rejection releases budget without overwriting the existing poster', async t => {
  const f = await fixture(t, async () => Response.json({ error: { message: key } }, { status: 403 }));
  await f.request(f.path + '/cover', input(f.a().revision)); await until(() => f.a().aiCover?.phase === 'failed');
  assert.equal(f.p().usage.at(-1).amountUsd, 0); assert.equal(f.a().mediaData, png); assert(!JSON.stringify(f.p()).includes(key));
});
