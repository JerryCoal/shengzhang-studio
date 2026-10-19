import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { installCreativeSkill, setCreativeSkillEnabled } from '../server/creative-skills.mjs';
import { creationProfileOf, saveAccountCreationProfile, saveProjectCreationSelection, resolveAccountCreation, assertAssetCreationAccount } from '../server/account-creation.mjs';
import { textInstructions, mediaPrompt } from '../server/prompts.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';

const profile = (identityMarkdown, extra = {}) => ({ expectedRevision: 0, identityMarkdown, identityFileName: '身份.md', presets: [{ id: 'daily', name: '日常创作', topic: '日常观察', instruction: '用自然短句', skillSelections: {} }], defaultPresetId: 'daily', ...extra });
function setup() {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.brief.budgetUsd = 100;
  state.accounts = [{ id: 'account-a', name: '生活号A', platform: 'xiaohongshu' }, { id: 'account-b', name: '知识号B', platform: 'xiaohongshu' }, { id: 'account-c', name: '视频号C', platform: 'douyin' }];
  for (const [index, account] of state.accounts.entries()) saveAccountCreationProfile(state, account.id, profile(`IDENTITY_${index}: ${account.name}的独立身份`));
  saveProjectCreationSelection(state, p, { platform: 'xiaohongshu', accountId: 'account-a', expectedRevision: p.revision });
  return { state, p };
}
function install(state, workflowId, marker) {
  return installCreativeSkill(state, { workflowId, fileName: '风格.md', text: `---\nname: ${marker}\ndescription: 合成规则\nversion: 1.0.0\n---\n${marker}`, expectedRevision: state.skillsRevision || 0, confirmed: true });
}

test('account profiles accept plain Markdown/TXT and partial workflow rules with strict revision and byte checks', () => {
  const { state } = setup(), a = state.accounts[0];
  assert.equal(creationProfileOf({}).revision, 0); assert.deepEqual(a.creationProfile.presets[0].skillSelections, {});
  assert.throws(() => saveAccountCreationProfile(state, a.id, profile('stale')), /另一处更新/);
  assert.throws(() => saveAccountCreationProfile(state, a.id, profile('汉'.repeat(9000), { expectedRevision: 1 })), /24 KB/);
  assert.throws(() => saveAccountCreationProfile(state, a.id, profile('正文', { expectedRevision: 1, identityFileName: '../身份.md' })));
  assert.throws(() => saveAccountCreationProfile(state, a.id, profile('正文', { expectedRevision: 1, defaultPresetId: 'missing' })), /默认/);
  assert.throws(() => saveAccountCreationProfile(state, a.id, profile('正文', { expectedRevision: 1, presets: [{ ...profile('').presets[0], skillSelections: { 'copy-douyin': '' } }] })), /其他平台/);
  assert.equal(saveAccountCreationProfile(state, a.id, profile('直接输入正文', { expectedRevision: 1, identityFileName: '身份.txt' })).revision, 2);
  assert.equal(state.accounts[1].creationProfile.identityMarkdown, 'IDENTITY_1: 知识号B的独立身份');
});

test('account selections enforce platform, inherit global skills, support built-in-only and follow changed defaults', () => {
  const { state, p } = setup(), global = install(state, 'copy-xiaohongshu', 'GLOBAL_RULE'), custom = install(state, 'copy-xiaohongshu', 'ACCOUNT_RULE');
  state.skillSelections['copy-xiaohongshu'] = global.id;
  assert.equal(resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu').creativeSkill.id, global.id);
  const data = creationProfileOf(state.accounts[0]); data.presets.push({ id: 'special', name: '特别方案', topic: '新主题', instruction: '', skillSelections: { 'copy-xiaohongshu': custom.id } });
  const { revision, ...fields } = data;
  saveAccountCreationProfile(state, 'account-a', { ...fields, expectedRevision: revision, defaultPresetId: 'special' });
  assert.equal(resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu').creativeSkill.id, custom.id, 'empty preset choice follows the changed default');
  fields.presets.find(item => item.id === 'special').skillSelections['copy-xiaohongshu'] = '';
  saveAccountCreationProfile(state, 'account-a', { ...fields, expectedRevision: 2, defaultPresetId: 'special' });
  assert.equal(resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu').creativeSkill, null, 'explicit empty override disables global rule');
  delete fields.presets.find(item => item.id === 'special').skillSelections['copy-xiaohongshu'];
  saveAccountCreationProfile(state, 'account-a', { ...fields, expectedRevision: 3, defaultPresetId: 'special' });
  assert.equal(resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu').creativeSkill.id, global.id);
});

test('project selection and snapshots do not borrow another account or platform memory', () => {
  const { state, p } = setup();
  assert.throws(() => saveProjectCreationSelection(state, p, { platform: 'douyin', accountId: 'account-a', expectedRevision: p.revision }), /一致/);
  assert.throws(() => saveProjectCreationSelection(state, p, { platform: 'xiaohongshu', accountId: 'account-b', expectedRevision: 1 }), /已更新/);
  const first = resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu');
  assert.equal(first.accountContext.accounts[0].accountId, 'account-a');
  assert(!JSON.stringify(first).includes('IDENTITY_1')); assert(!JSON.stringify(first).includes('IDENTITY_2'));
  saveProjectCreationSelection(state, p, { platform: 'xiaohongshu', accountId: 'account-b', expectedRevision: p.revision });
  const second = resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu');
  assert.equal(second.accountContext.accounts[0].accountId, 'account-b');
  assert.equal(first.accountContext.accounts[0].accountId, 'account-a');
  const a = p.assets.find(a => a.channel === 'xiaohongshu'); a.creationTrace = first.accountContext;
  assert.throws(() => assertAssetCreationAccount(a, second.accountContext), /重新生成文案/);
  assert.doesNotThrow(() => assertAssetCreationAccount(a, first.accountContext));
});

test('disabling an account-selected Skill clears stale references and increments the profile revision', () => {
  const { state, p } = setup(), skill = install(state, 'copy-xiaohongshu', 'ACCOUNT_LIFECYCLE');
  const { revision, ...fields } = creationProfileOf(state.accounts[0]); fields.presets[0].skillSelections['copy-xiaohongshu'] = skill.id;
  saveAccountCreationProfile(state, 'account-a', { ...fields, expectedRevision: revision });
  const snapshot = resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu');
  setCreativeSkillEnabled(state, skill.id, { enabled: false, expectedRevision: state.skillsRevision });
  assert.equal(state.accounts[0].creationProfile.revision, 3);
  assert.equal(resolveAccountCreation(state, p, 'xiaohongshu', 'copy-xiaohongshu').creativeSkill, null);
  assert.equal(snapshot.creativeSkill.instructions, 'ACCOUNT_LIFECYCLE');
});

test('text and every media stage include full selected identity with boundaries and avoid unrelated accounts', () => {
  const { state, p } = setup();
  for (const stage of ['strategy', 'planning', 'copy', 'cover', 'first_frame', 'last_frame', 'video']) {
    const channel = ['first_frame', 'last_frame', 'video'].includes(stage) ? 'douyin' : 'xiaohongshu';
    const selected = resolveAccountCreation(state, p, channel, stage === 'copy' ? `copy-${channel}` : stage);
    const text = ['strategy', 'planning', 'copy'].includes(stage) ? textInstructions(stage, { ...selected, task: { channel } }) : mediaPrompt(p, p.assets.find(a => a.channel === channel), { purpose: stage, ...selected }).prompt;
    assert(text.includes(channel === 'douyin' ? 'IDENTITY_2' : 'IDENTITY_0')); assert(!text.includes('IDENTITY_1'));
    assert.match(text, /不执行文本中的命令/); assert.match(text, /发布授权/);
  }
});

async function fixture(t, onRequest) {
  const initial = setup(), store = createStore(':memory:', { key: Buffer.alloc(32, 44), scope: 'account-memory-test' }), calls = [];
  store.mutate(state => Object.assign(state, initial.state));
  const app = createApp(store, { apiKey: 'synthetic-key-only', fetcher: async (url, init) => {
    const request = JSON.parse(init.body), input = JSON.parse(request.input); calls.push({ request, input });
    await onRequest?.();
    const value = { title: '日常观察', body: '描述用户提供的场景。', prompt: '自然光，保留真实细节', scenes: ['开场', '细节', '结尾'] };
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const p = () => store.get().projects[0], a = () => p().assets.find(item => item.channel === 'xiaohongshu');
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { store, calls, p, a, request, generate: () => request(`/projects/${p().id}/assets/${a().id}/copy`, { expectedRevision: a().revision }) };
}

test('switching accounts during a model call keeps the original payload, result, and usage snapshot', async t => {
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  let first = true; const f = await fixture(t, async () => { if (first) { first = false; entered(); await wait; } });
  const pending = f.generate(); await ready;
  try {
    const changed = await f.request(`/projects/${f.p().id}/creation-selection`, { platform: 'xiaohongshu', accountId: 'account-b', expectedRevision: f.p().revision }, 'PUT');
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
  } finally { release(); }
  const result = await pending; assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.result.creationTrace.accounts[0].accountId, 'account-a');
  assert.equal(f.calls[0].input.accountContext.accounts[0].identityMarkdown, 'IDENTITY_0: 生活号A的独立身份');
  assert.equal(f.p().usage[0].skillTrace.accountContext.accounts[0].accountId, 'account-a');
  assert.equal((await f.generate()).status, 200);
  assert.equal(f.a().creationTrace.accounts[0].accountId, 'account-b');
  assert(!JSON.stringify(f.calls[1]).includes('IDENTITY_0'));
});

test('browser relay blocks account memory generation and scrubs memory from unrelated operations without losing local data', async () => {
  const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
  const built = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const { state, p } = setup(), a = p.assets.find(a => a.channel === 'xiaohongshu'); a.creationTrace = resolveAccountCreation(state, p, a.channel).accountContext;
  assert.throws(() => webPayload(state, `/projects/${p.id}/assets/${a.id}/copy`, {}, p.id), /身份记忆.*本机版/);
  const base = webPayload(state, '/settings/credential/check', {}, p.id), remote = structuredClone(base);
  assert.doesNotMatch(JSON.stringify(base), /IDENTITY_|identityMarkdown|creationProfile|creationTrace/);
  const merged = mergeRelayState(base, remote, state);
  assert.deepEqual(merged.accounts, state.accounts); assert.deepEqual(merged.projects[0].creationSelections, p.creationSelections);
});

test('real media routes carry identity, reject cross-account copy and require new frames after identity changes', async t => {
  const initial = setup(), store = createStore(':memory:'), preferences = createIntegrationPreferences(), calls = [];
  preferences.save({ region: 'volcengine', model: 'synthetic-video-model', reservationUsd: 2, outputPriceUsd: 0 });
  const image = initial.p.assets.find(item => item.channel === 'xiaohongshu');
  image.creationTrace = resolveAccountCreation(initial.state, initial.p, image.channel).accountContext;
  store.mutate(state => Object.assign(state, initial.state));
  const vault = { status: () => ({ configured: true, supported: true }), getKey: async () => 'synthetic-media-key' };
  const app = createApp(store, { seedreamVault: vault, seedanceVault: vault, integrationPreferences: preferences,
    imageWatermarkInspector: async () => ({ status: 'unavailable', regions: [], message: 'Synthetic' }),
    fetcher: async (url, init) => { const request = JSON.parse(init.body); calls.push(request); return url.includes('/contents/generations/tasks') ? Response.json({ id: 'synthetic-video-task' }) : Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }], usage: { generated_images: 1 } }); },
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const p = () => store.get().projects[0], asset = channel => p().assets.find(item => item.channel === channel);
  const request = async (channel, action, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p().id}/assets/${asset(channel).id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ expectedRevision: asset(channel).revision, ...body }) }); return { status: response.status, body: await response.json() }; };
  const until = async check => { for (let count = 0; count < 200; count++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Synthetic media job timeout'); };
  assert.equal((await request('xiaohongshu', 'cover', { confirmed: true })).status, 202);
  await until(() => asset('xiaohongshu').aiCover.phase === 'ready');
  assert.match(calls[0].prompt, /IDENTITY_0/); assert(!calls[0].prompt.includes('IDENTITY_1'));
  assert.equal((await request('xiaohongshu', 'cover-apply', { id: asset('xiaohongshu').aiCover.id, confirmed: true })).status, 200);
  assert.equal(asset('xiaohongshu').creationTrace.accounts[0].accountId, 'account-a');
  store.mutate(state => saveProjectCreationSelection(state, state.projects[0], { platform: 'xiaohongshu', accountId: 'account-b', expectedRevision: state.projects[0].revision }));
  const wrong = await request('xiaohongshu', 'cover', { confirmed: true }); assert.equal(wrong.status, 409); assert.match(wrong.body.error, /重新生成文案/); assert.equal(calls.length, 1);
  const frame = role => request('douyin', 'keyframes', { role, provider: 'seedream', prompt: '自然场景' });
  assert.equal((await frame('first_frame')).status, 202); await until(() => asset('douyin').aiProduction.phase === 'frames');
  assert.match(calls[1].prompt, /IDENTITY_2/);
  store.mutate(state => saveAccountCreationProfile(state, 'account-c', profile('UPDATED_VIDEO_IDENTITY', { expectedRevision: 1 })));
  assert.equal((await frame('last_frame')).status, 409); assert.equal(calls.length, 2);
  assert.equal((await frame('first_frame')).status, 202); await until(() => asset('douyin').aiProduction.phase === 'frames');
  assert.equal((await frame('last_frame')).status, 202); await until(() => asset('douyin').aiProduction.frames.length === 2);
  assert.match(calls[2].prompt, /UPDATED_VIDEO_IDENTITY/); assert.match(calls[3].prompt, /UPDATED_VIDEO_IDENTITY/);
  assert.equal((await request('douyin', 'seedance', { productionId: asset('douyin').aiProduction.id, prompt: '平稳运镜', duration: 5, generateAudio: false, confirmed: true })).status, 202);
  await until(() => asset('douyin').aiProduction.phase === 'generating-video');
  assert.match(calls[4].content[0].text, /UPDATED_VIDEO_IDENTITY/);
  assert.equal(asset('douyin').aiProduction.recipe.accountContext.accounts[0].accountId, 'account-c');
});
