import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const jpg = Buffer.from('ffd8ffe000044a46ffd9', 'hex').toString('base64');
const secondImage = `data:image/jpeg;base64,${jpg}`;
const brief = (extra = {}) => ({
  name: '城市日常账号', type: 'nurture', brand: '', product: '', goal: '', audience: '', sellingPoints: '', facts: '', requirements: '',
  channels: ['douyin'], deadline: '2026-12-31', budgetUsd: 10,
  nurture: { topic: '街角咖啡时光', scene: '午后街角咖啡店，木桌、窗边阳光和打开的笔记本。', copyPrompt: '用两段轻松短句讲述观察，结尾邀请读者分享喜欢的角落。' }, ...extra,
});
const response = value => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
const strategyOutput = { title: '街角片刻', core: '留意日常的一束光', direction: '真实记录日常画面', prompt: '围绕用户选择的主题与场景写自然图文' };
const copyOutput = { title: '窗边的下午', body: '光线缓缓经过木桌，翻过一页笔记。\n\n你喜欢坐在哪一个角落？', prompt: '窗边木桌和笔记本，柔和自然光', scenes: ['窗边自然光', '桌上的笔记本', '咖啡杯细节'] };
const coverInput = revision => ({ expectedRevision: revision, prompt: '保留主要场景，柔和自然光', style: 'natural', layout: 'top', textMode: 'none', confirmed: true });

async function fixture(t, options = {}) {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences();
  preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: .04 });
  const app = createApp(store, {
    integrationPreferences: preferences,
    seedreamVault: { status: () => ({ configured: true, supported: true }), getKey: async () => 'nurture-test-key' },
    imageWatermarkInspector: async () => ({ status: 'unavailable', engine: 'test', checkedAt: new Date().toISOString(), regions: [], message: 'Synthetic test image.' }),
    fetcher: async () => assert.fail('No model request should occur in this test'), ...options,
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const req = async (path, method = 'GET', body) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, data: await result.json() };
  };
  const create = async input => { const result = await req('/projects', 'POST', input); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.result; };
  const p = id => store.get().projects.find(p => p.id === id);
  return { req, create, p, store };
}
async function until(check) { for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Nurture cover task did not finish'); }

test('nurture creation consumes only a matching saved draft and rejects invalid input atomically', async t => {
  const f = await fixture(t), incomplete = brief({ nurture: { topic: '', scene: '保留尚未写完的场景', copyPrompt: '' } });
  const saved = await f.req('/editor-drafts/new', 'PUT', { brief: incomplete, expectedVersion: 0 });
  assert.equal(saved.status, 200); assert.deepEqual((await f.req('/editor-drafts/new')).data.brief.nurture, incomplete.nurture);
  const before = f.store.get().projects.length;
  for (const input of [
    { ...incomplete, editorDraftVersion: 1 },
    { ...brief(), imageData: 'data:image/png;base64,AAAA', editorDraftVersion: 1 },
    { ...brief(), channels: ['youtube'], editorDraftVersion: 1 },
  ]) assert.equal((await f.req('/projects', 'POST', input)).status, 400);
  assert.equal(f.store.get().projects.length, before); assert.equal((await f.req('/editor-drafts/new')).data.version, 1);
  assert.equal((await f.req('/projects', 'POST', { ...brief(), editorDraftVersion: 2 })).status, 409);
  const p = await f.create({ ...brief(), imageData: png, editorDraftVersion: 1 });
  assert.equal(p.imageData, png); assert.equal(p.brief.imageData, undefined); assert.equal(p.assets[0].kind, 'image');
  assert.equal((await f.req('/editor-drafts/new')).data, null);
  assert.equal((await f.req('/projects', 'POST', { ...brief(), editorDraftVersion: 1 })).status, 409);
});

test('automatic nurture content respects custom rules and disabled default replacements', async t => {
  const f = await fixture(t), nurture = { topic: '最好的一刻', scene: '午后街角的木桌。', copyPrompt: '写成简短日常观察。' };
  const customRules = [
    { id: 'disabled-best', term: '最好', replacement: '适合', enabled: false },
    { id: 'custom-scene', term: '街角', replacement: '窗边', enabled: true },
  ];
  assert.equal((await f.req('/content-rules', 'PUT', { expectedRevision: 0, rules: customRules })).status, 200);
  const custom = await f.create(brief({ nurture }));
  assert.equal(custom.assets[0].title, '最好的一刻');
  assert.match(custom.assets[0].body, /窗边/); assert.doesNotMatch(custom.assets[0].body, /街角/);
  assert.deepEqual(custom.strategies[0].briefSnapshot.nurture, nurture);
  assert.equal((await f.req('/content-rules', 'PUT', { expectedRevision: 1, rules: [] })).status, 200);
  const disabled = await f.create(brief({ nurture }));
  assert.equal(disabled.assets[0].title, '最好的一刻'); assert.match(disabled.assets[0].body, /街角/);
  assert.equal(disabled.assets[0].copyReview.rulesCount, 0);
});

test('real strategy and copy request payloads retain nurture instructions, omit image bytes and isolate confirmed versions', async t => {
  const calls = [];
  const f = await fixture(t, { apiKey: 'fake-test', fetcher: async (_url, init) => {
    const request = JSON.parse(init.body); calls.push(request);
    return response(request.text.format.name === 'marketing_copy' ? copyOutput : strategyOutput);
  } });
  const original = brief({ imageData: png }), p = await f.create(original), a = p.assets[0];
  const other = await f.create(brief({ name: '隔离项目', imageData: secondImage, nurture: { topic: '另一个项目独有主题', scene: '另一个项目独有场景', copyPrompt: '另一个项目独有写作偏好' } }));
  assert.equal((await f.req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 200);
  const current = f.p(p.id), edited = { ...current.brief, nurture: { topic: '修改后的当前主题', scene: '修改后的当前场景', copyPrompt: '修改后的当前写作偏好' } };
  assert.equal((await f.req(`/projects/${p.id}`, 'PATCH', { brief: edited, expectedRevision: current.revision })).status, 200);
  assert.equal((await f.req(`/projects/${p.id}/assets/${a.id}/copy`, 'POST', { expectedRevision: a.revision, instruction: '' })).status, 200);
  assert.equal(calls.length, 2);
  for (const request of calls) {
    const payload = JSON.parse(request.input); assert.deepEqual(payload.brief.nurture, original.nurture);
    assert.match(request.instructions, /养号/); assert(request.instructions.includes(original.nurture.copyPrompt));
    assert(!payload.brief.facts.includes(original.nurture.copyPrompt));
    for (const secret of [png, secondImage, ...Object.values(other.brief.nurture), ...Object.values(edited.nurture)]) assert(!JSON.stringify(request).includes(secret));
  }
  assert.equal(JSON.parse(calls[1].input).task.kind, 'image');
  assert.equal(f.p(p.id).assets[0].body, copyOutput.body); assert.equal(f.p(other.id).usage.length, 0);
});

test('nurture text generation respects zero budget before dispatch', async t => {
  let calls = 0; const f = await fixture(t, { apiKey: 'fake-test', fetcher: async () => { calls++; return response(strategyOutput); } });
  const p = await f.create(brief({ budgetUsd: 0 }));
  assert.equal((await f.req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 400);
  assert.equal((await f.req(`/projects/${p.id}/assets/${p.assets[0].id}/copy`, 'POST', { expectedRevision: 1 })).status, 400);
  assert.equal(calls, 0); assert.equal(f.p(p.id).usage.length, 0);
  assert.equal(f.p(p.id).strategies.length, 1); assert.equal(f.p(p.id).assets.length, 1);
});

test('all supported nurture image channels use cover generation and reject cross-project asset IDs', async t => {
  const calls = [];
  const f = await fixture(t, { fetcher: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); } });
  const p = await f.create(brief({ channels: ['xiaohongshu', 'douyin', 'tiktok', 'instagram'], imageData: png }));
  const other = await f.create(brief({ imageData: secondImage, nurture: { topic: '项目乙主题', scene: '项目乙场景', copyPrompt: '项目乙写作指令' } }));
  assert.equal((await f.req(`/projects/${other.id}/assets/${p.assets[0].id}/cover`, 'POST', coverInput(1))).status, 404);
  for (const a of p.assets) {
    const path = `/projects/${p.id}/assets/${a.id}`;
    assert.equal((await f.req(`${path}/cover`, 'POST', coverInput(a.revision))).status, 202);
    await until(() => f.p(p.id).assets.find(saved => saved.id === a.id).aiCover?.phase === 'ready');
    const candidate = f.p(p.id).assets.find(saved => saved.id === a.id);
    assert.equal(candidate.mediaData, '', 'paid candidate requires explicit adoption');
    assert.equal((await f.req(`${path}/cover-apply`, 'POST', { id: candidate.aiCover.id, expectedRevision: candidate.revision, confirmed: true })).status, 200);
    assert.equal(f.p(p.id).assets.find(saved => saved.id === a.id).status, 'ready');
  }
  assert.equal(calls.length, 4);
  for (const call of calls) { assert.deepEqual(call.image, [png]); assert.equal(call.size, '1728x2304'); for (const value of Object.values(p.brief.nurture)) assert(call.prompt.includes(value)); assert(!call.prompt.includes('项目乙')); }
  assert.equal(f.p(other.id).usage.length, 0); assert.equal(f.p(other.id).assets[0].aiCover, undefined);
  assert.equal(f.p(p.id).publications.length, 0);
});

test('nurture cover checks confirmation, budget and valid scene image before paid dispatch', async t => {
  let calls = 0; const f = await fixture(t, { fetcher: async () => { calls++; return Response.json({}); } });
  const p = await f.create(brief({ budgetUsd: 0 })), path = `/projects/${p.id}/assets/${p.assets[0].id}/cover`;
  assert.equal((await f.req(path, 'POST', coverInput(1))).status, 400);
  f.store.mutate(state => { state.projects.find(saved => saved.id === p.id).brief.budgetUsd = 10; });
  assert.equal((await f.req(path, 'POST', { ...coverInput(1), confirmed: false })).status, 400);
  assert.equal((await f.req(`/projects/${p.id}/media`, 'PUT', { kind: 'image', data: 'data:image/png;base64,AAAA' })).status, 400);
  f.store.mutate(state => { state.projects.find(saved => saved.id === p.id).imageData = 'data:image/png;base64,AAAA'; });
  assert.equal((await f.req(path, 'POST', coverInput(1))).status, 400);
  assert.equal(calls, 0); assert.equal(f.p(p.id).usage.length, 0);
});

test('in-flight nurture cover uses its original project image and rejects duplicate requests', async t => {
  let release, dispatched; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { dispatched = resolve; });
  const calls = [];
  const f = await fixture(t, { fetcher: async (_url, init) => { calls.push(JSON.parse(init.body)); dispatched(); await gate; return Response.json({ data: [{ b64_json: jpg }], usage: { generated_images: 1 } }); } });
  const p = await f.create(brief({ imageData: png })), a = p.assets[0], path = `/projects/${p.id}/assets/${a.id}/cover`;
  const other = await f.create(brief({ name: '其他账号项目', imageData: secondImage }));
  try {
    assert.equal((await f.req(path, 'POST', coverInput(a.revision))).status, 202); await entered;
    assert.equal((await f.req(path, 'POST', coverInput(a.revision))).status, 409);
    assert.equal((await f.req(`/projects/${p.id}/media`, 'PUT', { kind: 'image', data: secondImage })).status, 200);
  } finally { release(); }
  await until(() => f.p(p.id).assets[0].aiCover?.phase === 'ready');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].image, [png]);
  assert.equal(f.p(p.id).imageData, secondImage); assert.equal(f.p(p.id).usage.length, 1); assert.equal(f.p(p.id).usage[0].status, 'completed');
  assert.equal(f.p(other.id).usage.length, 0); assert.equal(f.p(other.id).assets[0].aiCover, undefined);
});
