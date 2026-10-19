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
const unchecked = () => ({ status: 'unavailable', engine: 'test', checkedAt: '2026-10-14T00:00:00.000Z', regions: [], message: 'Synthetic fixture; no OCR is run.' });
async function fixture(t, fetcher, options = {}) {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences(); preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: .04 });
  store.mutate(state => { const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.imageData = png; const a = p.assets.find(a => a.kind === 'image'); updateAsset(p, a.id, { title: a.title, body: a.body, mediaData: png, mime: 'image/png', expectedRevision: a.revision }); importCorpus(p, { name: '已核实的包装介绍', text: '产品外观为米白色独立包装，绿色品牌标识。' }); p.brief.facts = '后来修改但尚未用于此策略的事实'; });
  const app = createApp(store, { seedreamVault: { status: () => ({ configured: true, supported: true }), getKey: async () => key }, integrationPreferences: preferences, fetcher, imageWatermarkInspector: async () => unchecked(), ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await app.locals.integrations.close(); await new Promise(r => server.close(r)); store.close(); });
  const p = () => store.get().projects[0], a = () => p().assets.find(a => a.kind === 'image');
  const path = `/projects/${p().id}/assets/${a().id}`;
  const request = async (path, body, method = 'POST') => { const response = await fetch(url + '/api' + path, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  return { app, store, p, a, path, request, url, preferences };
}
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Cover task did not finish'); }

test('cover and text for different assets run together while the same asset stays protected', { timeout: 10000 }, async t => {
  let finishText, finishImage, textStarted = false, imageStarted = false;
  const textWait = new Promise(resolve => { finishText = resolve; }), imageWait = new Promise(resolve => { finishImage = resolve; });
  const f = await fixture(t, async (url) => {
    if (url.includes('/images/')) { imageStarted = true; await imageWait; return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); }
    textStarted = true; await textWait;
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: '日常使用说明', body: '依据已核实的事实介绍使用方式。', prompt: '自然光产品画面', scenes: ['开场', '演示', '总结'] }) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  }, { apiKey: 'synthetic-only' });
  const video = f.p().assets.find(asset => asset.kind === 'video');
  const writing = f.request(`/projects/${f.p().id}/assets/${video.id}/copy`, { expectedRevision: video.revision });
  try {
    await until(() => textStarted);
    assert.equal((await f.request(f.path + '/cover', input(f.a().revision))).status, 202);
    await until(() => imageStarted);
    assert.equal((await f.request(f.path + '/copy', { expectedRevision: f.a().revision })).status, 409, 'copy cannot invalidate an in-flight image of the same asset');
    assert.equal((await f.request(`/projects/${f.p().id}/assets/${video.id}/keyframes`, { provider: 'seedream', role: 'first_frame', prompt: '自然光', expectedRevision: video.revision })).status, 409, 'image cannot race with the same asset copy');
  } finally { finishText(); finishImage(); }
  assert.equal((await writing).status, 200);
  await until(() => f.a().aiCover?.phase === 'ready');
  assert.equal(f.p().usage.filter(usage => usage.status === 'completed').length, 2);
});

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
  const zip = await JSZip.loadAsync(await download.arrayBuffer()); assert.equal(zip.file(/^01-素材\/.+\.jpg$/).length, 1);
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

test('cover watermark overrides only this request and saves the actual request and inspection result', async t => {
  const cases = [
    { saved: true, requested: false, status: 'detected', encoded: jpg, mime: 'image/jpeg' },
    { saved: false, requested: true, status: 'not_detected', encoded: png.split(',')[1], mime: 'image/png' },
    { saved: false, requested: undefined, status: 'unavailable', encoded: jpg, mime: 'image/jpeg' },
  ];
  for (const scenario of cases) await t.test(`${scenario.saved} default / ${scenario.requested ?? 'inherit'} request / ${scenario.status}`, async t => {
    const watermark = scenario.requested ?? scenario.saved;
    const check = { ...unchecked(), status: scenario.status, message: `Synthetic ${scenario.status}`, regions: scenario.status === 'detected' ? [{ x: 0, y: 0, width: 12, height: 8, text: 'AI生成' }] : [] };
    let fetches = 0, checks = 0;
    const data = `data:${scenario.mime};base64,${scenario.encoded}`;
    const f = await fixture(t, async (_url, init) => {
      fetches++; assert.equal(JSON.parse(init.body).watermark, watermark);
      return Response.json({ data: [{ b64_json: scenario.encoded }], usage: { generated_images: 1 } });
    }, { imageWatermarkInspector: async mediaData => { checks++; assert.equal(mediaData, data); return check; } });
    f.preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: .04, watermark: scenario.saved });
    const body = { ...input(f.a().revision), ...(scenario.requested === undefined ? {} : { watermark: scenario.requested }) };
    assert.equal((await f.request(f.path + '/cover', body)).status, 202);
    await until(() => f.a().aiCover?.phase === 'ready');
    assert.equal(f.a().aiCover.watermarkRequested, watermark);
    assert.deepEqual(f.a().aiCover.watermarkCheck, check);
    assert.equal(f.a().aiCover.mediaData, data);
    assert.equal(f.preferences.get().seedream.watermark, scenario.saved);
    assert.equal((await f.request('/integrations', undefined, 'GET')).body.seedream.watermark, scenario.saved);
    assert.equal(f.p().usage.at(-1).status, 'completed'); assert.equal(f.p().usage.at(-1).amountUsd, .04);
    assert.equal(fetches, 1); assert.equal(checks, 1);
  });
});

test('cover inspection failure preserves the paid JPEG, completed accounting and adoption without retry', async t => {
  let fetches = 0, checks = 0;
  const f = await fixture(t, async () => { fetches++; return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); }, {
    imageWatermarkInspector: async mediaData => { checks++; assert.equal(mediaData, `data:image/jpeg;base64,${jpg}`); throw Error('private-inspector-diagnostic'); },
  });
  assert.equal((await f.request(f.path + '/cover', { ...input(f.a().revision), watermark: false })).status, 202);
  await until(() => f.a().aiCover?.phase === 'ready');
  const check = f.a().aiCover.watermarkCheck;
  assert.equal(check.status, 'unavailable'); assert(Number.isFinite(Date.parse(check.checkedAt))); assert.deepEqual(check.regions, []);
  assert.equal(f.a().aiCover.watermarkRequested, false);
  assert.equal(f.a().aiCover.mediaData, `data:image/jpeg;base64,${jpg}`);
  assert.equal(f.p().usage.at(-1).status, 'completed'); assert.equal(f.p().usage.at(-1).amountUsd, .04);
  assert.equal((await f.request(f.path + '/cover-apply', { id: f.a().aiCover.id, expectedRevision: f.a().revision, confirmed: true })).status, 200);
  assert.equal(f.a().mediaData, `data:image/jpeg;base64,${jpg}`); assert.deepEqual(f.a().aiCover.watermarkCheck, check);
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  assert.equal(fetches, 1); assert.equal(checks, 1); assert.equal(f.a().aiCover.phase, 'applied');
  assert(!JSON.stringify((await f.request('/state', undefined, 'GET')).body).includes('private-inspector-diagnostic'));
});

test('cover saves the request settings snapshot even when the default changes before completion', async t => {
  let complete; const gate = new Promise(resolve => { complete = resolve; });
  const f = await fixture(t, async (_url, init) => { assert.equal(JSON.parse(init.body).watermark, false); await gate; return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); });
  f.preferences.saveSeedream({ ...defaultSeedream, watermark: false, imagePriceUsd: .04 });
  try {
    assert.equal((await f.request(f.path + '/cover', input(f.a().revision))).status, 202);
    assert.equal(f.a().aiCover.watermarkRequested, false);
    // Simulate a separately loaded preference update; a paid job owns its original snapshot.
    f.preferences.saveSeedream({ ...defaultSeedream, watermark: true, imagePriceUsd: .09 });
  } finally { complete(); }
  await until(() => f.a().aiCover?.phase === 'ready');
  assert.equal(f.a().aiCover.watermarkRequested, false); assert.equal(f.p().usage.at(-1).amountUsd, .04);
  assert.equal(f.preferences.get().seedream.watermark, true);
});

test('invalid cover watermark never dispatches and old cover records do not invent inspection results', async t => {
  let fetches = 0, checks = 0;
  const f = await fixture(t, async () => { fetches++; return Response.json({}); }, { imageWatermarkInspector: async () => { checks++; return unchecked(); } });
  for (const watermark of ['false', 0, null]) assert.equal((await f.request(f.path + '/cover', { ...input(f.a().revision), watermark })).status, 400);
  assert.equal(fetches, 0); assert.equal(f.p().usage.length, 0);
  f.store.mutate(state => { const asset = state.projects[0].assets.find(a => a.id === f.a().id); asset.aiCover = { id: 'legacy-cover', phase: 'ready', assetRevision: asset.revision, mediaData: png, model: defaultSeedream.model }; });
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  for (const path of ['/state', '/backup']) {
    const serialized = JSON.stringify((await f.request(path, undefined, 'GET')).body);
    assert(serialized.includes('legacy-cover')); assert(!serialized.includes('watermarkCheck')); assert(!serialized.includes('watermarkRequested'));
  }
  assert.equal(f.a().aiCover.mediaData, png); assert.equal(checks, 0); assert.equal(fetches, 0);
});
