import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, DEEPSEEK_ROUTES } from '../server/models.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { setBuiltinSkill } from '../server/builtin-skills.mjs';
import { saveAccountCreationProfile } from '../server/account-creation.mjs';
import { XHS_TITLE_DIMENSIONS, XHS_NOTE_DIMENSIONS } from '../server/xhs-assistant.mjs';

const fakeKey = 'isolated-xhs-assistant-fixture-not-a-real-key';
const vault = { status: () => ({ supported: true, configured: true }), getKey: async () => fakeKey };
const noteId = '687df3a1000000000d0184a4';
const source = { id: noteId, title: '校园自习准备清单', desc: '选择安静位置，提前核对开放时间。', createTime: new Date(Date.now() - 86400000).toISOString(), cover: 'https://sns.xhscdn.com/test.png', likedCount: 18, collectedCount: 8 };
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 150 } });
function answer(payload) {
  const common = { summary: '依据有限输入提供建议。', limitations: ['小样本仅供参考。'], evidence: payload.samples.length ? [{ sampleId: payload.samples[0].id, quote: payload.samples[0].title }] : [] };
  const mode = payload.input.mode, sampleIds = payload.samples.slice(0, 1).map(row => row.id);
  if (['create', 'rewrite'].includes(mode)) return { ...common, title: '先准备，再开始自习', body: '先核对开放时间，再选择适合自己的安静位置。', prompt: '3:4 静态画面，桌面与笔记本。', scenes: ['桌面准备', '笔记整理', '安静阅读'] };
  if (mode === 'titles') return { ...common, titles: Array.from({ length: 10 }, (_, i) => ({ title: `自习准备的角度${i + 1}`, reason: '表达具体内容。', matchScore: 6, sampleIds })) };
  if (mode === 'title-score') return { ...common, dimensions: XHS_TITLE_DIMENSIONS.map(row => ({ id: row.id, score: 6, reason: '标题表达较为明确。' })), improvements: ['补充明确价值。'], alternatives: [{ title: '自习前的准备清单', reason: '主题清晰。' }, { title: '自习前先核对开放时间', reason: '行动明确。' }] };
  if (mode === 'note-score') return { ...common, dimensions: XHS_NOTE_DIMENSIONS.map(row => ({ id: row.id, score: 75, reason: '需要结合更多样本。' })), strengths: ['主题具体。'], improvements: ['补充流程。'], keywords: ['自习'] };
  return { ...common, observations: (payload.visionReferenceIds || []).map(sampleId => ({ sampleId, observation: '顶部标题，下方是桌面。' })), plans: Array.from({ length: 3 }, (_, i) => ({ name: `方案${i + 1}`, headline: '自习准备', prompt: `3:4 静态方案${i + 1}，桌面留白。`, layout: '顶部标题', colors: '米白色', reason: '按实际提供的资料设计。', sampleIds })) };
}
async function fixture(t, options = {}) {
  const store = options.store || createStore(':memory:'), modelStore = createModelStore(), calls = [], behavior = {};
  modelStore.save({ ...DEEPSEEK_ROUTES, ...options.routes });
  if (!options.store) store.mutate(state => {
    const p = state.projects[0]; p.brief.budgetUsd = 20; p.usage = []; confirmStrategy(p, p.strategies[0].id);
    saveAccountCreationProfile(state, 'account-xhs', { identityMarkdown: 'ACCOUNT_A_IDENTITY：关注校园学习。', identityFileName: 'account.md', presets: [], defaultPresetId: '', expectedRevision: 0 });
  });
  const preferences = createIntegrationPreferences(); preferences.saveRedfox({ enabled: true, mediaEnabled: false, searchEnabled: false });
  const app = createApp(store, { profileMode: true, modelStore, deepseekVault: vault, vault, apiKey: fakeKey, redfoxVault: vault, integrationPreferences: preferences,
    fetcher: async (url, init) => {
      assert(['https://api.deepseek.com/chat/completions', 'https://api.openai.com/v1/responses'].includes(url)); const request = JSON.parse(init.body);
      const content = request.messages ? request.messages[1].content : request.input;
      const payload = JSON.parse(typeof content === 'string' ? content : request.messages ? content[0].text : content[0].content[0].text);
      calls.push({ kind: 'model', request, payload }); if (behavior.model) return await behavior.model(payload, request);
      return request.messages ? completion(answer(payload)) : Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer(payload)) }] }], usage: { input_tokens: 100, output_tokens: 150 } });
    },
    redfoxFetcher: async (url, init) => {
      assert.equal(url, 'https://redfox.hk/story/api/xhs/search/search'); const body = JSON.parse(init.body); calls.push({ kind: 'samples', body });
      if (behavior.samples) return await behavior.samples(body);
      return Response.json({ code: 2000, data: { articles: [source], latestHotArticles: [{ id: '000000000000000000000000', title: '不匹配兜底' }] } });
    }, ...options.config });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); if (!options.keepStore) store.close(); });
  const current = () => store.get().projects[0], base = `/projects/${current().id}/xhs-assistant`;
  const req = async (path = '', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path.startsWith('/projects/') || path.startsWith('/settings') ? path : base + path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const collect = (extra = {}) => req('/samples', { keyword: '校园自习', days: 7, requestId: randomUUID(), confirmed: true, ...extra });
  const run = (extra = {}) => req('/runs', { mode: 'create', keyword: '校园自习', requestId: randomUUID(), confirmed: true, ...extra });
  return { store, app, server, req, current, collect, run, calls, behavior, base, modelStore };
}
const good = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.result; };

test('samples use one documented call, bind billing, preserve unknown metrics, deduplicate request IDs and never call a model', async t => {
  const f = await fixture(t), requestId = randomUUID(), saved = good(await f.collect({ requestId }));
  assert.equal(saved.items.length, 1); assert.equal(saved.items[0].metrics.shares, null); assert.equal(saved.reservationCny, .06);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, { keyword: '校园自习', pageNum: 1, pageSize: 50, startDate: saved.startDate, endDate: saved.endDate });
  const billed = f.store.get().redfoxUsage; assert.equal(billed.length, 1); assert.equal(billed[0].accountId, 'account-xhs'); assert.equal(billed[0].amountCny, .06); assert.equal(billed[0].taskId, saved.id);
  assert.equal(good(await f.collect({ requestId })).id, saved.id); assert.equal(f.calls.length, 1);
  assert.equal((await f.collect({ requestId, keyword: '其他主题' })).status, 409); assert.equal(f.calls.length, 1);
  assert.equal(f.current().usage.length, 0); assert.equal(f.current().researchUsage, undefined);
});

test('all text modes run against one frozen workflow and only explicitly adopted outputs change an existing asset', async t => {
  const f = await fixture(t), sample = good(await f.collect()), asset = f.current().assets.find(row => row.channel === 'xiaohongshu'), before = structuredClone(asset);
  f.store.mutate(state => {
    setBuiltinSkill(state, { workflowId: 'xhs-creator', skillId: 'redfox-xiaohongshu-creator', instructions: 'ORIGINAL_CREATOR_RULE 本次按真实事实创作。', expectedRevision: state.skillsRevision });
    setBuiltinSkill(state, { workflowId: 'cover', skillId: 'cover-art-direction', instructions: 'UNRELATED_COVER_RULE 不应泄漏。', expectedRevision: state.skillsRevision });
  });
  const estimate = await f.req('/estimate', { mode: 'create', sampleId: sample.id, assetId: asset.id, expectedAssetRevision: asset.revision });
  assert.equal(estimate.status, 200); assert(estimate.data.reservationUsd > 0); assert.equal(estimate.data.imageReservationUsd, 0); assert.equal(f.calls.length, 1);
  f.behavior.model = async payload => {
    f.store.mutate(state => setBuiltinSkill(state, { workflowId: 'xhs-creator', skillId: 'redfox-xiaohongshu-creator', instructions: 'NEXT_CREATOR_RULE 仅下一次生效。', expectedRevision: state.skillsRevision }));
    return completion(answer(payload));
  };
  const requestId = randomUUID(), run = good(await f.run({ requestId, sampleId: sample.id, assetId: asset.id, expectedAssetRevision: asset.revision }));
  assert.equal(run.status, 'completed'); assert.equal(run.stale, false); assert.equal(run.skillTrace.workflowId, 'xhs-creator');
  assert.match(run.skillTrace.builtin[0].instructions, /ORIGINAL_CREATOR_RULE/); assert.match(JSON.stringify(f.calls[1].request), /ACCOUNT_A_IDENTITY/);
  assert.doesNotMatch(JSON.stringify(f.calls[1].request), /UNRELATED_COVER_RULE|NEXT_CREATOR_RULE/); assert.equal(f.calls[1].payload.builtinSkills, undefined); assert.equal(f.calls[1].request.thinking.type, 'disabled');
  assert.deepEqual(f.current().assets.find(row => row.id === asset.id), before);
  assert.equal(good(await f.run({ requestId, sampleId: sample.id, assetId: asset.id, expectedAssetRevision: asset.revision })).id, run.id); assert.equal(f.calls.length, 2);
  const adopted = good(await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, confirmed: true }));
  assert.equal(adopted.title, run.result.title); assert.equal(adopted.revision, asset.revision + 1); assert.equal(adopted.status, 'queued');
  assert.equal(adopted.creationTrace.accounts[0].accountId, 'account-xhs');
  assert.equal(good(await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, confirmed: true })).revision, adopted.revision);
  assert.equal(f.current().usage.length, 1); assert.equal(f.current().usage[0].status, 'completed'); assert.equal(f.current().usage[0].estimated, false);
});

test('score reports need real samples and calculate grades; selected optimized titles and cover plans require explicit adoption', async t => {
  const f = await fixture(t);
  for (const mode of ['title-score', 'note-score']) assert.equal((await f.run({ mode, title: '自习准备', body: '核对开放时间。' })).status, 400);
  assert.equal(f.calls.length, 0);
  const sample = good(await f.collect());
  const scored = good(await f.run({ mode: 'title-score', sampleId: sample.id, title: '自习准备' })); assert.equal(scored.result.totalScore, 6); assert.equal(scored.result.grade, 'B');
  const note = good(await f.run({ mode: 'note-score', sampleId: sample.id, body: '核对开放时间。' })); assert.equal(note.result.totalScore, 75);
  let asset = f.current().assets.find(row => row.channel === 'xiaohongshu');
  assert.equal((await f.req('/adopt', { runId: note.id, assetId: asset.id, expectedRevision: asset.revision, confirmed: true })).status, 400);
  assert.equal((await f.req('/adopt', { runId: scored.id, assetId: asset.id, expectedRevision: asset.revision, confirmed: true })).status, 400);
  asset = good(await f.req('/adopt', { runId: scored.id, assetId: asset.id, expectedRevision: asset.revision, choiceIndex: 1, confirmed: true })); assert.equal(asset.title, scored.result.alternatives[1].title);
  const cover = good(await f.run({ mode: 'cover-plan', sampleId: sample.id, assetId: asset.id, expectedAssetRevision: asset.revision }));
  const planned = good(await f.req('/adopt', { runId: cover.id, assetId: asset.id, expectedRevision: asset.revision, choiceIndex: 2, confirmed: true }));
  assert.equal(planned.xhsCoverPlan.appliedRevision, planned.revision); assert.equal(planned.xhsCoverPlan.prompt, cover.result.plans[2].prompt); assert.equal(planned.mediaData, '');
  assert.equal(f.calls.filter(row => row.kind === 'samples').length, 1); assert.equal(f.calls.filter(row => row.kind === 'model').length, 3);
});

test('account switches during a request keep a paid historical result stale and cannot overwrite another account', async t => {
  const f = await fixture(t), asset = f.current().assets.find(row => row.channel === 'xiaohongshu');
  f.behavior.model = async payload => { f.store.mutate(state => {
    state.accounts.push({ id: 'account-b', name: '账号B', platform: 'xiaohongshu' }); state.projects[0].creationSelections = { xiaohongshu: { accountId: 'account-b', presetId: '' } };
  }); return completion(answer(payload)); };
  const run = good(await f.run({ assetId: asset.id, expectedAssetRevision: asset.revision })); assert.equal(run.stale, true); assert.match(run.staleReason, /账号/); assert.equal(run.accountId, 'account-xhs');
  assert.equal((await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, confirmed: true })).status, 409);
  assert.equal(f.current().assets.find(row => row.id === asset.id).revision, asset.revision); assert.equal(f.current().usage[0].status, 'completed');
  assert.equal(f.calls.length, 1);
});

test('failed model validation records actual tokens, keeps samples and never retries or re-collects', async t => {
  const f = await fixture(t), sample = good(await f.collect()), requestId = randomUUID();
  f.behavior.model = async () => completion({ secret: 'do-not-echo-provider-output' });
  const failed = await f.run({ requestId, sampleId: sample.id }); assert.equal(failed.status, 502); assert.doesNotMatch(JSON.stringify(failed.data), /do-not-echo/);
  const replay = good(await f.run({ requestId, sampleId: sample.id })); assert.equal(replay.status, 'uncertain'); assert.equal(replay.estimated, false);
  assert.equal(f.calls.length, 2); assert.equal(f.current().xhsAssistant.samples[0].id, sample.id); assert.equal(f.current().usage[0].status, 'uncertain'); assert(f.current().usage[0].amountUsd > 0);
});

test('empty and failed samples do not expand their date window or fall back to unmatching recommendations', async t => {
  const f = await fixture(t); f.behavior.samples = () => Response.json({ code: 2000, data: { articles: [], latestHotArticles: [source] } });
  const empty = good(await f.collect({ days: 1 })); assert.equal(empty.items.length, 0); assert.match(empty.warnings.join(' '), /没有有效匹配样本/);
  assert.equal((await f.run({ mode: 'note-score', sampleId: empty.id, body: '待评分正文' })).status, 400);
  f.behavior.samples = () => { throw Error('secret-internal-network-detail'); }; const requestId = randomUUID();
  assert.equal((await f.collect({ requestId })).status, 502); assert.equal(good(await f.collect({ requestId })).status, 'uncertain');
  assert.equal(f.calls.length, 2); assert.equal(f.store.get().redfoxUsage.length, 2); assert.equal(f.current().usage.length, 0);
});

test('project locks reject duplicate operations while in flight; remote clients and vision without images incur no calls', async t => {
  const f = await fixture(t); let release, started;
  const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  f.behavior.model = async payload => { started(); await wait; return completion(answer(payload)); };
  const requestId = randomUUID(), pending = f.run({ requestId }); await entered;
  assert.equal((await f.run({ requestId })).status, 202); assert.equal((await f.collect()).status, 409); assert.equal((await f.run()).status, 409);
  release(); good(await pending); assert.equal(f.calls.length, 1);
  assert.equal((await f.req('/estimate', { mode: 'cover-plan', vision: true })).status, 400);
  assert.equal((await f.run({ mode: 'cover-plan', vision: true })).status, 400);
  assert.equal((await f.req('', undefined, { 'X-Forwarded-For': '203.0.113.10' })).status, 403);
  assert.equal(f.calls.length, 1);
});

test('selected DeepSeek Flash analyzes the exact sample images once, includes the image reservation and keeps visual adoption trace', async t => {
  const f = await fixture(t), sample = good(await f.collect()), asset = f.current().assets.find(row => row.channel === 'xiaohongshu');
  const status = await f.req(); assert.equal(status.data.models.vision.model, 'deepseek-flash'); assert.equal(status.data.models.vision.supported, true);
  const input = { mode: 'cover-plan', sampleId: sample.id, vision: true, assetId: asset.id, expectedAssetRevision: asset.revision };
  const estimate = await f.req('/estimate', input); assert.equal(estimate.status, 200); assert.equal(estimate.data.imageCount, 1); assert.equal(estimate.data.imageReservationUsd, 1024 * .3 / 1e6);
  const run = good(await f.run(input)); assert.equal(run.result.vision, true); assert.equal(run.result.observations.length, 1); assert.equal(run.model, 'deepseek-flash');
  const request = f.calls.at(-1).request; assert.equal(request.model, 'deepseek-flash'); assert.equal(request.thinking.type, 'disabled');
  assert.deepEqual(request.messages[1].content.filter(row => row.type === 'image_url'), [{ type: 'image_url', image_url: { url: source.cover, detail: 'low' } }]);
  assert.match(request.messages[0].content, /每张图片/); assert.equal(f.calls.length, 2);
  const adopted = good(await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, choiceIndex: 0, confirmed: true })); assert.equal(adopted.xhsCoverPlan.vision, true);
});

test('visual requests keep the selected OpenAI model and reject unsupported DeepSeek/Qwen without silent fallback', async t => {
  const f = await fixture(t, { routes: { copy: 'gpt-5.4-nano' } }), sample = good(await f.collect());
  const estimate = await f.req('/estimate', { mode: 'cover-plan', sampleId: sample.id, vision: true }); assert.equal(estimate.status, 200); assert.equal(estimate.data.imageReservationUsd, 25000 * .2 / 1e6);
  const run = good(await f.run({ mode: 'cover-plan', sampleId: sample.id, vision: true })); assert.equal(run.model, 'gpt-5.4-nano'); assert.equal(run.provider, 'openai');
  assert.equal(f.calls.at(-1).request.model, 'gpt-5.4-nano'); assert.equal(f.calls.at(-1).request.input[0].content.filter(row => row.type === 'input_image').length, 1);
  for (const model of ['deepseek-v4-pro', 'qwen-plus', 'qwen-flash']) {
    f.modelStore.save({ ...f.modelStore.get(), copy: model }); const before = f.calls.length;
    const status = await f.req(); assert.equal(status.data.models.vision.model, model); assert.equal(status.data.models.vision.supported, false);
    const denied = await f.run({ mode: 'cover-plan', sampleId: sample.id, vision: true }); assert.equal(denied.status, 400); assert.match(denied.data.error, /图片|文字/); assert.equal(f.calls.length, before);
  }
});

test('title batch contains ten suggestions and no-sample rewrite still carries the account identity without claiming source analysis', async t => {
  const f = await fixture(t), titles = good(await f.run({ mode: 'titles' })); assert.equal(titles.result.titles.length, 10); assert.equal(titles.result.references.length, 0);
  const rewritten = good(await f.run({ mode: 'rewrite', body: '提前核对开放时间再去自习。' })); assert.equal(rewritten.status, 'completed'); assert.match(rewritten.warnings.join(' '), /没有联网样本/);
  assert.match(f.calls.at(-1).request.messages[0].content, /ACCOUNT_A_IDENTITY/); assert.equal(f.calls.length, 2);
});

test('budget rejection and missing key never spend on a model or erase prior sample results', async t => {
  const f = await fixture(t), sample = good(await f.collect()); f.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  assert.equal((await f.run({ sampleId: sample.id })).status, 400); assert.equal(f.calls.length, 1); assert.equal(f.current().xhsAssistant.runs.length, 0);
  const noKey = await fixture(t, { config: { deepseekVault: undefined } });
  assert.equal((await noKey.run()).status, 400); assert.equal(noKey.calls.length, 0); assert.equal(noKey.current().usage[0].amountUsd, 0); assert.equal(noKey.current().xhsAssistant.runs[0].status, 'failed');
});

test('restart recovery preserves running reservations as uncertain and replay never starts another paid request', async t => {
  const store = createStore(':memory:'), requestId = randomUUID();
  store.mutate(state => { const p = state.projects[0]; p.usage = [{ id: 'usage-old', status: 'running', amountUsd: .05 }]; p.xhsAssistant = { samples: [], runs: [{ id: 'old-run', requestId, requestFingerprint: 'old-hash', status: 'running', mode: 'create', input: { mode: 'create' }, usageId: 'usage-old', reservationUsd: .05 }], requestLedger: [{ requestId, fingerprint: 'old-hash', kind: 'runs' }] }; });
  const f = await fixture(t, { store }); assert.equal(f.current().xhsAssistant.runs[0].status, 'uncertain'); assert.equal(f.current().usage[0].status, 'uncertain'); assert.equal(f.current().usage[0].amountUsd, .05);
  assert.equal((await f.run({ requestId })).status, 409); assert.equal(f.calls.length, 0);
});

test('estimate confirmation locks the selected model and maximum reservation before any new fee', async t => {
  const f = await fixture(t), estimate = (await f.req('/estimate', { mode: 'create', keyword: '校园自习' })).data;
  f.modelStore.save({ ...f.modelStore.get(), copy: 'deepseek-v4-pro' });
  assert.equal((await f.run({ expectedModel: estimate.model, maxReservationUsd: estimate.reservationUsd })).status, 409);
  assert.equal(f.calls.length, 0); assert.equal(f.current().usage.length, 0);
  f.modelStore.save({ ...f.modelStore.get(), copy: estimate.model });
  assert.equal((await f.run({ expectedModel: estimate.model, maxReservationUsd: 0 })).status, 409); assert.equal(f.calls.length, 0);
  const run = good(await f.run({ expectedModel: estimate.model, maxReservationUsd: estimate.reservationUsd })); assert.equal(run.model, estimate.model); assert.equal(f.calls.length, 1);
});

test('status reports analysis separately and a saved cover plan binds an otherwise unbound asset to its creation account', async t => {
  const f = await fixture(t, { routes: { copy: 'gpt-5.4-mini', analysis: 'deepseek-flash' }, config: { seedreamVault: vault } });
  const status = (await f.req()).data; assert.equal(status.models.text.model, 'gpt-5.4-mini'); assert.equal(status.models.analysis.model, 'deepseek-flash'); assert.equal(status.models.analysis.configured, true);
  let asset = f.current().assets.find(row => row.channel === 'xiaohongshu'); assert.equal(asset.creationTrace, undefined);
  const run = good(await f.run({ mode: 'cover-plan', assetId: asset.id, expectedAssetRevision: asset.revision }));
  asset = good(await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, choiceIndex: 0, confirmed: true }));
  assert.equal(asset.creationTrace.accounts[0].accountId, 'account-xhs');
  assert.equal((await f.req('/adopt', { runId: run.id, assetId: asset.id, expectedRevision: asset.revision, choiceIndex: 1, confirmed: true })).status, 409);
  f.store.mutate(state => { state.accounts.push({ id: 'account-b', name: '账号B', platform: 'xiaohongshu' }); state.projects[0].creationSelections = { xiaohongshu: { accountId: 'account-b', presetId: '' } }; });
  const result = await f.req(`/projects/${f.current().id}/assets/${asset.id}/cover`, { expectedRevision: asset.revision, prompt: asset.xhsCoverPlan.prompt, confirmed: true });
  assert.equal(result.status, 409); assert.match(result.data.error, /属于/); assert.equal(f.calls.length, 1);
});
