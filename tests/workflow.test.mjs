import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import * as d from '../server/domain.mjs';
import * as w from '../server/workflow.mjs';

const rule = (term, replacement, enabled = true) => ({ id: term, term, replacement, enabled });
const output = value => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
async function fixture(t, options = {}) {
  const store = createStore(':memory:'), app = createApp(store, options), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); store.close(); });
  const req = async (path, method = 'GET', body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  return { req, store, p: store.get().projects[0] };
}

test('copy screening handles literal regex characters, longest matches, case, disabled terms and immutable source facts', () => {
  const input = { title: 'VIP 全网第一 第一 a+b [test]', body: '全网第一 全网第一', scenes: ['a+b', 'VIP', '保留'], facts: '全网第一', corpus: [{ text: 'VIP' }] };
  const before = structuredClone(input), rules = [rule('第一', '推荐'), rule('全网第一', '品牌精选'), rule('a+b', '简洁'), rule('[test]', '示例'), rule('vip', '会员'), rule('保留', '删除', false)];
  const { value, review } = w.screenCopy(input, rules);
  assert.equal(value.title, '会员 品牌精选 推荐 简洁 示例'); assert.equal(value.body, '品牌精选 品牌精选'); assert.deepEqual(value.scenes, ['简洁', '会员', '保留']);
  assert.equal(review.hits.find(h => h.field === 'body').count, 2); assert.deepEqual(input, before); assert.equal(value.facts, '全网第一'); assert.equal(value.corpus[0].text, 'VIP');
  assert.deepEqual(w.screenCopy(input, []).value, input);
  assert.equal(w.screenCopy({ title: 'ſ' }, [rule('s', '字母')]).value.title, '字母');
  assert.throws(() => w.screenCopy({ title: '词'.repeat(150) }, [rule('词', '很长的替换表达')]), /过长/);
});

test('rules preserve user choices across migration and reject duplicates, stale writes, cycles and blank generated titles', () => {
  const state = w.normalizeWorkflow(d.seedState());
  assert.equal(state.contentRules.length, 26);
  w.saveRules(state, { expectedRevision: 0, rules: [rule('敏感', '平实')] });
  assert.throws(() => w.saveRules(state, { expectedRevision: 0, rules: [] }), /另一处/);
  assert.throws(() => w.saveRules(state, { expectedRevision: 1, rules: [rule('A', 'ok'), rule('a', 'good')] }), /重复/);
  assert.throws(() => w.saveRules(state, { expectedRevision: 1, rules: [rule('A', 'B'), rule('B', 'A')] }), /循环/);
  assert.throws(() => w.reviewObject({ title: '敏感' }, [rule('敏感', '')]), /标题为空/);
  w.saveRules(state, { expectedRevision: 1, rules: [] }); w.normalizeWorkflow(state); assert.deepEqual(w.rulesOf(state), []);
});

test('corpus search isolates projects, respects enable/delete and keeps original evidence snapshots', async t => {
  const { req, p } = await fixture(t);
  const imported = await req(`/projects/${p.id}/corpus`, 'POST', { name: '咖啡资料', text: '户外咖啡装包演示。\n\n保存原文：全网第一。', format: 'txt' });
  assert.equal(imported.status, 200); const doc = imported.data.result;
  assert.equal((await req(`/projects/${p.id}/corpus`, 'POST', { name: '重复', text: doc.text })).status, 409);
  const found = await req(`/projects/${p.id}/corpus/search`, 'POST', { query: '户外咖啡' }); assert.equal(found.data.results[0].documentId, doc.id);
  const other = (await req('/projects', 'POST', { ...p.brief, name: '另一个项目' })).data.result;
  assert.deepEqual((await req(`/projects/${other.id}/corpus/search`, 'POST', { query: '户外咖啡' })).data.results, []);
  const generated = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'demo', query: '户外咖啡' }); assert.equal(generated.status, 200);
  assert.ok(generated.data.result.prompt.includes('咖啡资料')); const strategyId = generated.data.result.id;
  await req(`/projects/${p.id}/corpus/${doc.id}`, 'PATCH', { enabled: false });
  assert.deepEqual((await req(`/projects/${p.id}/corpus/search`, 'POST', { query: '户外咖啡' })).data.results, []);
  await req(`/projects/${p.id}/corpus/${doc.id}`, 'DELETE');
  const state = (await req('/state')).data; assert.equal(state.projects.find(x => x.id === p.id).strategies.find(s => s.id === strategyId).corpusReferences[0].text, found.data.results[0].text);
  assert.ok(w.chunkText('咖'.repeat(3000)).every(c => c.text.length <= 900));
});

test('AI generation retrieves current project corpus and screens all output fields with current user rules', async t => {
  const payloads = []; let copying = false;
  const { req, p, store } = await fixture(t, { apiKey: 'fake-test', fetcher: async (_, init) => {
    payloads.push(JSON.parse(JSON.parse(init.body).input));
    // The user can update their dictionary while a model is responding.
    store.mutate(s => w.saveRules(s, { expectedRevision: s.rulesRevision, rules: [rule('测试禁词', '平实表达')] }));
    return output(copying ? { title: '测试禁词标题', body: '测试禁词正文', prompt: '测试禁词要求', scenes: ['测试禁词开场', '测试禁词演示', '测试禁词结尾'] } : { title: '测试禁词标题', core: '测试禁词核心', direction: '测试禁词方向', prompt: '测试禁词制作' });
  } });
  await req(`/projects/${p.id}/corpus`, 'POST', { name: '咖啡原始资料', text: '咖啡户外携带。原文含测试禁词。' });
  const strategy = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai', query: '咖啡' });
  assert.equal(strategy.status, 200); assert.equal(strategy.data.result.title, '平实表达标题'); assert.equal(payloads[0].corpusReferences[0].name, '咖啡原始资料');
  const confirmed = await req(`/projects/${p.id}/strategies/${strategy.data.result.id}/confirm`, 'POST', {});
  const a = confirmed.data.state.projects[0].assets[0]; copying = true;
  const copy = await req(`/projects/${p.id}/assets/${a.id}/copy`, 'POST', { expectedRevision: a.revision, instruction: '咖啡' });
  assert.equal(copy.status, 200); const result = copy.data.result;
  for (const text of [result.title, result.body, result.prompt, ...result.scenes]) assert.ok(text.startsWith('平实表达'));
  assert.deepEqual(new Set(result.copyReview.hits.map(h => h.field)), new Set(['title', 'body', 'prompt', '分镜1', '分镜2', '分镜3']));
  assert.equal(result.corpusReferences[0].name, '咖啡原始资料'); assert.match(copy.data.state.projects[0].corpus[0].text, /测试禁词/);
  assert.deepEqual(copy.data.state.projects[0].brief, p.brief);
});

test('existing ready media is invalidated and archived when new rules change visible copy', async t => {
  const { req, p, store } = await fixture(t);
  await req(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`, 'POST', {});
  store.mutate(s => { const a = s.projects[0].assets[0]; a.title = '敏感标题'; a.status = 'ready'; a.mediaData = 'old-media'; });
  const asset = store.get().projects[0].assets[0];
  await req('/content-rules', 'PUT', { expectedRevision: 0, rules: [rule('敏感', '温和')] });
  const checked = await req(`/projects/${p.id}/assets/${asset.id}/review`, 'POST', { expectedRevision: asset.revision });
  assert.equal(checked.status, 200); assert.equal(checked.data.result.status, 'queued'); assert.equal(checked.data.result.title, '温和标题'); assert.equal(checked.data.result.history[0].title, '敏感标题');
  assert.equal((await req(`/projects/${p.id}/assets/${asset.id}/review`, 'POST', { expectedRevision: asset.revision })).status, 409);
});

test('autosave retains incomplete forms without replacing project facts, then applies valid edits', async t => {
  const { req, p } = await fixture(t);
  const path = `/editor-drafts/${p.id}`, incomplete = { ...p.brief, name: '', facts: '尚在编辑的事实' };
  let saved = await req(path, 'PUT', { brief: incomplete, expectedVersion: 0, baseBrief: p.brief });
  assert.equal(saved.status, 200); assert.equal(saved.data.draft.applied, false); assert.deepEqual(saved.data.project.brief, p.brief);
  assert.equal((await req(path)).data.brief.name, '');
  saved = await req(path, 'PUT', { brief: { ...incomplete, name: '完整项目' }, expectedVersion: 1, baseBrief: p.brief });
  assert.equal(saved.data.draft.applied, true); assert.equal(saved.data.project.brief.facts, '尚在编辑的事实');
  assert.equal((await req(path, 'PUT', { brief: p.brief, expectedVersion: 1, baseBrief: p.brief })).status, 409);
  const current = (await req('/state')).data.projects[0]; assert.equal(current.brief.name, '完整项目'); assert.equal(current.strategies[0].briefSnapshot.name, p.brief.name);
});

test('autosave detects competing brief changes but allows unrelated background project updates', async t => {
  const { req, p, store } = await fixture(t);
  store.mutate(s => { s.projects[0].revision++; });
  const path = `/editor-drafts/${p.id}`;
  const first = await req(path, 'PUT', { brief: { ...p.brief, name: '我的输入' }, expectedVersion: 0, baseBrief: p.brief }); assert.equal(first.data.draft.applied, true);
  store.mutate(s => { s.projects[0].brief.name = '另一窗口已保存'; });
  const conflict = await req(path, 'PUT', { brief: { ...p.brief, name: '继续输入' }, expectedVersion: 1, baseBrief: first.data.draft.baseBrief });
  assert.equal(conflict.data.draft.conflict, true); assert.equal(conflict.data.draft.brief.name, '继续输入'); assert.equal(conflict.data.project.brief.name, '另一窗口已保存');
});

test('project creation atomically consumes the matching draft and preserves it on invalid input', async t => {
  const { req, p } = await fixture(t);
  await req('/editor-drafts/new', 'PUT', { brief: { ...p.brief, name: '' }, expectedVersion: 0 });
  assert.equal((await req('/projects', 'POST', { ...p.brief, name: '', editorDraftVersion: 1 })).status, 400);
  assert.equal((await req('/editor-drafts/new')).data.version, 1);
  assert.equal((await req('/projects', 'POST', { ...p.brief, editorDraftVersion: 2 })).status, 409);
  assert.equal((await req('/projects', 'POST', { ...p.brief, name: '正式项目', editorDraftVersion: 1 })).status, 201);
  assert.equal((await req('/editor-drafts/new')).data, null);
  assert.equal((await req('/projects', 'POST', { ...p.brief, editorDraftVersion: 1 })).status, 409);
});
