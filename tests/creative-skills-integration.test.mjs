import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from '../server/copy-skills.generated.mjs';

const selectedText = 'SELECTED_STYLE_SENTINEL：先描述真实校园场景，再说明服务边界。';
const otherText = 'UNSELECTED_PRIVATE_STYLE_SENTINEL：这条未选择的规则不得发送。';
const markdown = (name = 'campus-copy', instructions = selectedText, platforms = 'xiaohongshu, douyin') => `---\nname: ${name}\ndescription: 测试用宣传文案规则\nmetadata:\n  version: 2026.10.14\nplatforms: [${platforms}]\nstages: [copy]\n---\n${instructions}`;
const sampleImage = 'data:image/png;base64,iVBORw0KGgo=';

async function fixture(t, provider = 'openai', onRequest) {
  const calls = [], store = createStore(':memory:'), models = createModelStore();
  if (provider !== 'openai') models.save({ ...models.get(), copy: provider === 'qwen' ? 'qwen-plus' : 'deepseek-v4-pro' });
  const vault = { status: () => ({ supported: true, configured: true, problem: '' }), getKey: async () => 'sk-test-only-never-sent-to-network' };
  const app = createApp(store, { apiKey: 'test-only-no-real-key', modelStore: models, qwenVault: vault, deepseekVault: vault, fetcher: async (url, init) => {
    const request = JSON.parse(init.body), system = provider === 'openai' ? request.instructions : request.messages[0].content;
    const input = JSON.parse(provider === 'openai' ? request.input : request.messages[1].content);
    calls.push({ url, request, system, input });
    await onRequest?.({ store, request, input });
    const value = input.copyReview?.mode === 'semantic'
      ? { decisions: input.copyReview.matches.map(match => ({ id: match.id, decision: 'replace', reason: '这里是金额后的计价单位' })) }
      : input.copyReview
        ? { title: input.copyReview.title.replaceAll('神级', '适合'), body: input.copyReview.body.replaceAll('神级', '适合') }
        : { title: `校园自习体验 ${calls.length}`, body: '根据项目已确认事实介绍服务，适合有明确学习需求的读者。', prompt: '呈现真实校园学习环境。', scenes: ['真实环境', '功能说明', '参与条件'] };
    return provider === 'openai'
      ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 100 } })
      : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const p = store.get().projects[0];
  const confirmed = await req(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`, 'POST', {});
  assert.equal(confirmed.status, 200);
  const project = () => store.get().projects.find(value => value.id === p.id);
  const asset = (channel = 'xiaohongshu') => project().assets.find(value => value.channel === channel);
  const copy = (body = {}, channel = 'xiaohongshu') => { const item = asset(channel); return req(`/projects/${p.id}/assets/${item.id}/copy`, 'POST', { expectedRevision: item.revision, ...body }); };
  const install = async (text = markdown()) => {
    const result = await req('/creative-skills', 'POST', { fileName: 'SKILL.md', text, expectedRevision: store.get().skillsRevision, confirmed: true });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.result;
  };
  return { store, calls, req, project, asset, copy, install, p };
}

test('Skill API preview is read-only; catalog separates immutable builtin and user installations', async t => {
  const f = await fixture(t), before = f.store.get();
  const preview = await f.req('/creative-skills/preview', 'POST', { fileName: 'SKILL.md', text: markdown() });
  assert.equal(preview.status, 200); assert.equal(preview.data.version, '2026.10.14'); assert.deepEqual(f.store.get(), before); assert.equal(f.calls.length, 0);
  const invalid = await f.req('/creative-skills/preview', 'POST', { fileName: '../SKILL.md', text: markdown() });
  assert.equal(invalid.status, 400); assert.deepEqual(f.store.get(), before);
  const originalCatalog = (await f.req('/creative-skills')).data;
  assert.equal(originalCatalog.builtin.id, 'builtin'); assert.match(originalCatalog.builtin.instructions, /事实/); assert.equal(originalCatalog.skills.length, 0);
  const installed = await f.install();
  const catalog = (await f.req('/creative-skills')).data;
  assert.equal(catalog.revision, 1); assert.deepEqual(catalog.builtin, originalCatalog.builtin); assert.equal(catalog.skills.length, 1);
  for (const [key, value] of Object.entries(installed)) assert.deepEqual(catalog.skills[0][key], value, `installed ${key} is retained in the catalog`);
  assert.deepEqual(catalog.skills[0].eligibleWorkflowIds, ['copy-xiaohongshu', 'copy-douyin']);
  const duplicate = await f.req('/creative-skills', 'POST', { fileName: 'SKILL.md', text: markdown(), expectedRevision: 1, confirmed: true });
  assert.equal(duplicate.status, 409); assert.equal(f.store.get().skillsRevision, 1); assert.equal(f.calls.length, 0);
});

for (const provider of ['openai', 'deepseek', 'qwen']) test(`${provider} copy sends only the selected compact Skill with builtin instructions and records exact trace`, async t => {
  const f = await fixture(t, provider), selected = await f.install();
  await f.install(markdown('other-private', otherText));
  const result = await f.copy({ skillId: selected.id, instruction: '保持表达清晰' });
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.deepEqual(call.input.creativeSkill, { id: selected.id, name: selected.name, version: selected.version, instructions: selected.instructions });
  assert.deepEqual(Object.keys(call.input.creativeSkill).sort(), ['id', 'instructions', 'name', 'version']);
  assert(!JSON.stringify(call.request).includes(otherText)); assert(!call.system.includes(selectedText));
  assert(call.system.includes(COPY_SKILLS['marketing-copywriting'])); assert(call.system.includes(COPY_SKILLS['xiaohongshu-copywriting']));
  assert.match(call.system, /creativeSkill\.instructions/); assert.match(call.system, /不得改变接口字段/);
  assert.equal(Object.hasOwn(call.input, 'installedSkills'), false); assert.equal(Object.hasOwn(call.input, 'sourceText'), false);
  assert.equal(call.request.tools, undefined);
  const trace = result.data.result.skillTrace;
  assert.deepEqual(trace.user, call.input.creativeSkill); assert.deepEqual(trace.builtin.map(value => value.id), ['marketing-copywriting', 'xiaohongshu-copywriting', 'natural-copy-editing']);
  assert(call.system.includes(COPY_SKILLS['natural-copy-editing']));
  for (const item of trace.builtin) { assert.equal(item.version, COPY_SKILL_VERSIONS[item.id]); assert.equal(item.instructions, COPY_SKILLS[item.id]); }
  assert.equal(f.project().usage.length, 1); assert.equal(f.project().usage[0].status, 'completed');
});

test('disabled, missing and wrong-platform Skills fail before model calls or budget writes; omitted selection sends none', async t => {
  const f = await fixture(t), selected = await f.install(markdown('xhs-only', selectedText, 'xiaohongshu'));
  const before = structuredClone(f.project());
  assert.equal((await f.copy({ skillId: selected.id }, 'douyin')).status, 409);
  assert.equal((await f.copy({ skillId: 'skill-missing' })).status, 409);
  const disabled = await f.req(`/creative-skills/${selected.id}`, 'PATCH', { enabled: false, expectedRevision: 1 }); assert.equal(disabled.status, 200);
  assert.equal((await f.copy({ skillId: selected.id })).status, 409);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.project(), before);
  const defaultCopy = await f.copy(); assert.equal(defaultCopy.status, 200, JSON.stringify(defaultCopy.data));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.creativeSkill, null); assert(!JSON.stringify(f.calls[0].request).includes(selectedText)); assert.equal(defaultCopy.data.result.skillTrace.user, null);
});

test('words and price review paths ignore installed Skills and preserve the edited asset', async t => {
  const f = await fixture(t), selected = await f.install();
  const rules = [
    { id: 'rewrite-word', term: '神级', replacement: '', enabled: true, action: 'rewrite', risk: 'A' },
    { id: 'semantic-yuan', term: '元', replacement: '圆', enabled: true, action: 'semantic', risk: 'PRICE' },
  ];
  assert.equal((await f.req('/content-rules', 'PUT', { rules, expectedRevision: 0 })).status, 200);
  const before = f.asset();
  const words = await f.copy({ skillId: selected.id, reviewOnly: true, reviewMode: 'words', rulesRevision: 1, draft: { title: '神级学习环境', body: '根据已确认事实介绍服务。' } });
  assert.equal(words.status, 200, JSON.stringify(words.data)); assert.equal(words.data.result.candidate.title, '适合学习环境');
  const semantic = await f.copy({ skillId: 'skill-missing-intentionally-ignored', reviewOnly: true, reviewMode: 'semantic', rulesRevision: 1, draft: { title: '体验服务', body: '服务价格 19.9元起，具体条件以项目说明为准。' } });
  assert.equal(semantic.status, 200, JSON.stringify(semantic.data)); assert.match(semantic.data.result.candidate.body, /19\.9圆起/);
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) { assert.equal(Object.hasOwn(call.input, 'creativeSkill'), false); assert(!JSON.stringify(call.request).includes(selectedText)); assert(!call.system.includes(COPY_SKILLS['marketing-copywriting'])); }
  assert(f.calls[0].system.includes(COPY_SKILLS['sensitive-copy-review'])); assert(f.calls[1].system.includes(COPY_SKILLS['price-context-replacement']));
  assert.deepEqual(f.asset(), before); assert.equal(f.project().usage.length, 2);
});

test('deleting a Skill retains generated snapshots and the next default generation archives the prior trace', async t => {
  const f = await fixture(t), selected = await f.install();
  assert.equal((await f.copy({ skillId: selected.id })).status, 200);
  let current = f.asset(); const trace = structuredClone(current.skillTrace);
  const ready = await f.req(`/projects/${f.p.id}/assets/${current.id}`, 'PUT', { title: current.title, body: current.body, expectedRevision: current.revision, mediaData: sampleImage, mime: 'image/png' });
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  assert.equal((await f.req(`/creative-skills/${selected.id}`, 'DELETE', { expectedRevision: 1 })).status, 200);
  assert.deepEqual(f.asset().skillTrace, trace); assert.equal(f.store.get().installedSkills.length, 0);
  const backup = await f.req('/backup'); assert.equal(backup.status, 200); assert(JSON.stringify(backup.data).includes(selectedText));
  assert.equal((await f.copy()).status, 200);
  current = f.asset(); assert.equal(current.skillTrace.user, null); assert.deepEqual(current.history[0].skillTrace, trace);
  assert.equal(f.calls[1].input.creativeSkill, null); assert(!JSON.stringify(f.calls[1].request).includes(selectedText));
  const usageCount = f.project().usage.length;
  assert.equal((await f.copy({ skillId: selected.id })).status, 409); assert.equal(f.project().usage.length, usageCount); assert.equal(f.calls.length, 2);
});

test('changing an installed Skill during a request cannot overwrite the current asset with stale preferences', async t => {
  let id;
  const f = await fixture(t, 'openai', ({ store }) => store.mutate(state => { state.installedSkills.find(value => value.id === id).enabled = false; state.skillsRevision++; }));
  id = (await f.install()).id;
  const before = f.asset(), result = await f.copy({ skillId: id });
  assert.equal(result.status, 409); assert.match(result.data.error, /生成期间/); assert.deepEqual(f.asset(), before);
  assert.equal(f.calls.length, 1); assert.equal(f.project().usage.length, 1); assert.equal(f.project().usage[0].status, 'completed');
});

test('restoring historical content restores its Skill snapshot or removes a newer trace when the old version had none', async t => {
  const f = await fixture(t), selected = await f.install();
  const makeReady = async () => {
    const current = f.asset();
    const result = await f.req(`/projects/${f.p.id}/assets/${current.id}`, 'PUT', { title: current.title, body: current.body, expectedRevision: current.revision, mediaData: sampleImage, mime: 'image/png' });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return f.asset();
  };
  const withoutTrace = await makeReady(); assert.equal(withoutTrace.skillTrace, undefined);
  assert.equal((await f.copy({ skillId: selected.id })).status, 200);
  const withTrace = await makeReady(); assert.equal(withTrace.skillTrace.user.id, selected.id);
  assert.equal((await f.copy()).status, 200); assert.equal(f.asset().skillTrace.user, null);
  const path = `/projects/${f.p.id}/assets/${f.asset().id}/restore`;
  const selectedRestore = await f.req(path, 'POST', { revision: withTrace.revision });
  assert.equal(selectedRestore.status, 200, JSON.stringify(selectedRestore.data)); assert.deepEqual(f.asset().skillTrace, withTrace.skillTrace); assert.equal(f.asset().title, withTrace.title);
  const untrackedRestore = await f.req(path, 'POST', { revision: withoutTrace.revision });
  assert.equal(untrackedRestore.status, 200, JSON.stringify(untrackedRestore.data)); assert.equal(f.asset().title, withoutTrace.title); assert.equal(f.asset().skillTrace, undefined);
  assert.deepEqual(f.asset().history[0].skillTrace, withTrace.skillTrace);
  assert.equal(f.calls.length, 2);
});

test('local dictionary review preserves Skill provenance in both current content and the archived ready version', async t => {
  const f = await fixture(t), selected = await f.install();
  assert.equal((await f.copy({ skillId: selected.id })).status, 200);
  let current = f.asset();
  assert.equal((await f.req(`/projects/${f.p.id}/assets/${current.id}`, 'PUT', { title: current.title, body: current.body, expectedRevision: current.revision, mediaData: sampleImage, mime: 'image/png' })).status, 200);
  current = f.asset(); const before = structuredClone(current), callsBefore = f.calls.length;
  const saved = await f.req('/content-rules', 'PUT', { expectedRevision: 0, rules: [{ id: 'local-replace', term: '自习', replacement: '学习', action: 'replace', enabled: true, risk: 'A' }] });
  assert.equal(saved.status, 200);
  const reviewed = await f.req(`/projects/${f.p.id}/assets/${current.id}/review`, 'POST', { expectedRevision: current.revision });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  current = f.asset(); assert.match(current.title, /学习/); assert.notEqual(current.title, before.title); assert.deepEqual(current.skillTrace, before.skillTrace);
  assert.equal(current.history[0].revision, before.revision); assert.equal(current.history[0].title, before.title); assert.deepEqual(current.history[0].skillTrace, before.skillTrace);
  assert.equal(f.calls.length, callsBefore);
});
