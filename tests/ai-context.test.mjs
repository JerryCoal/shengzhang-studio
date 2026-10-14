import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { newProject, makeDraft, confirmStrategy } from '../server/domain.mjs';
import { importCorpus, corpusQuery, searchCorpus } from '../server/workflow.mjs';
import { previousStrategyContext, taskPromptContext } from '../server/ai-context.mjs';
import { skillVersionsFor } from '../server/ai-skill-registry.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const bundled = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const strategyOutput = { title: '下一轮预约说明', core: '说明实际预约条件', direction: '演示预约步骤', prompt: '展示预约步骤与适用条件，不编造服务能力。' };
const copyOutput = { title: '预约前先了解这些', body: '查看预约时段，再选择适合的座位。✨\n\n参与条件以项目资料为准。', prompt: '呈现安静的自习场景，产品信息与资料一致。', scenes: ['开场环境', '预约步骤', '行动指引'] };

function projectFixture() {
  const p = newProject({ name: '上下文回归项目', brand: 'Cedar', product: 'cedarworkflow', type: 'launch', goal: 'reservequietdesk', audience: '希望了解预约条件的读者', sellingPoints: '已知预约步骤', facts: '提供预约时段与自习座位。', requirements: '保留事实，表达清楚', channels: ['xiaohongshu', 'douyin'], deadline: '2026-10-20', budgetUsd: 100 });
  p.id = 'context-project'; p.createdAt = p.updatedAt = '2026-10-14T00:00:00.000Z';
  importCorpus(p, { name: 'cedarworkflow reservequietdesk', text: 'cedarworkflow reservequietdesk：可预约自习时段，真实容量以页面为准。', format: 'txt' });
  importCorpus(p, { name: 'nebulakitchen selloven', text: 'nebulakitchen selloven：这是另一轮改为厨房设备的资料。', format: 'txt' });
  p.corpus.forEach((doc, i) => { doc.id = `context-doc-${i}`; doc.importedAt = p.createdAt; });
  const s = makeDraft(p, { title: 'memoranda', core: '说明预约条件', direction: '展示真实场景与预约说明', prompt: '【原始策略规则】保留用户已确认事实和人工制作要求。\n' + '展示座位环境；提供预约说明；不增加未经核实的承诺。\n'.repeat(8) }, '', 'openai', [], 'cedarworkflow reservequietdesk');
  s.id = 'context-strategy'; s.createdAt = p.createdAt;
  confirmStrategy(p, s.id, []); s.confirmedAt = p.createdAt;
  p.assets.forEach((a, i) => { a.id = `context-asset-${i}`; a.createdAt = p.createdAt; a.copyReview.at = p.createdAt; });
  s.copyReview.at = p.createdAt; s.tasks.forEach(task => { task.copyReview.at = p.createdAt; });
  p.comments = [
    { id: 'comment-a', text: '希望看到预约时段。' },
    { id: 'comment-b', text: '有座位示意图吗？' },
    { id: 'comment-c', text: '我想了解参与条件。' },
  ];
  p.insights = [{ id: 'insight-a', evidenceIds: ['comment-a', 'comment-b'] }, { id: 'insight-b', evidenceIds: ['comment-b', 'comment-c'] }];
  p.experiences = [
    { id: 'experience-a', active: true, insightId: 'insight-a', text: '补充预约时段与座位说明。' },
    { id: 'experience-b', active: true, insightId: 'insight-b', text: '写清参与条件。' },
    { id: 'experience-inactive', active: false, insightId: 'insight-a', text: 'INACTIVE_FEEDBACK_SENTINEL' },
  ];
  return p;
}

async function fixture(t, { project = projectFixture(), state: suppliedState, onRequest } = {}) {
  const store = createStore(':memory:'), calls = [];
  store.mutate(state => { if (suppliedState) Object.assign(state, suppliedState); else state.projects = [project]; state.contentRules = []; });
  const app = createApp(store, { apiKey: 'test-only-no-network', fetcher: async (url, init) => {
    const request = JSON.parse(init.body), input = JSON.parse(request.input);
    const current = store.get().projects[0];
    calls.push({ url, request, input, reservedUsage: structuredClone(current.usage.at(-1)), storedPrompts: Object.fromEntries(current.assets.map(asset => [asset.id, asset.prompt])) });
    await onRequest?.({ store, input });
    const value = input.task ? copyOutput : strategyOutput;
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { store, calls, req, project: () => store.get().projects[0] };
}

test('previous strategy context is an exact field whitelist without changing stored strategy', () => {
  const s = projectFixture().strategies[0], original = structuredClone(s), result = previousStrategyContext(s);
  assert.deepEqual(Object.keys(result), ['id', 'version', 'status', 'title', 'core', 'direction', 'prompt']);
  for (const key of Object.keys(result)) assert.deepEqual(result[key], s[key]);
  assert.deepEqual(s, original);
  assert.equal(previousStrategyContext(undefined), undefined);
});

test('task context removes only a nonempty exact duplicated prefix and preserves every other byte', () => {
  const prefix = '精确策略\n第二行', suffix = '【任务要求】人工追加说明\n✨保留原样';
  assert.equal(taskPromptContext(`${prefix}\n\n${suffix}`, prefix), suffix);
  for (const value of [prefix, `${prefix}\n\n`, ` ${prefix}\n\n${suffix}`, `人工优先\n${prefix}\n\n${suffix}`, `${prefix}\r\n\r\n${suffix}`, `精确策略\n已改第二行\n\n${suffix}`, `任务中引用：${prefix}\n\n${suffix}`, '', undefined]) {
    assert.equal(taskPromptContext(value, prefix), value);
  }
  assert.equal(taskPromptContext(suffix, ''), suffix);
});

for (const stage of ['strategy', 'planning']) test(`HTTP ${stage} sends compact previous strategy, complete active feedback and versioned usage`, async t => {
  const f = await fixture(t), before = f.project(), s = before.strategies.at(-1);
  const result = await f.req(`/projects/${before.id}/strategies`, { mode: 'openai', stage, instruction: '保留原方向，补充演示步骤。' });
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(f.calls.length, 1);
  const call = f.calls[0], expected = Object.fromEntries(['id', 'version', 'status', 'title', 'core', 'direction', 'prompt'].map(key => [key, s[key]]));
  assert.deepEqual(call.input.previousStrategy, expected);
  assert.deepEqual(call.input.brief, before.brief);
  assert.deepEqual(call.input.feedback, [
    { text: before.experiences[0].text, evidence: [before.comments[0].text, before.comments[1].text] },
    { text: before.experiences[1].text, evidence: [before.comments[1].text, before.comments[2].text] },
  ]);
  assert(!JSON.stringify(call.input).includes('INACTIVE_FEEDBACK_SENTINEL'));
  assert.deepEqual(call.reservedUsage.skillVersions, skillVersionsFor(stage, call.input));
  const usage = f.project().usage.at(-1);
  assert.deepEqual(usage.skillVersions, call.reservedUsage.skillVersions); assert.equal(usage.status, 'completed');
  assert.deepEqual(usage.tokens, { input_tokens: 100, output_tokens: 50 });
  assert.equal(result.data.result.title, strategyOutput.title); assert.equal(result.data.result.core, strategyOutput.core);
  const feedbackText = before.experiences.filter(e => e.active).map(e => e.text).join('\n');
  assert.equal(result.data.result.direction, strategyOutput.direction + '\n本轮待验证改动：' + feedbackText);
  assert.equal(result.data.result.prompt, strategyOutput.prompt + '\n已采用的评论反馈（仅作为待验证假设）：\n' + feedbackText);
  assert.deepEqual(f.project().strategies[0], s, 'compaction must not rewrite the previous version');
  const beforeBytes = bytes({ ...call.input, previousStrategy: s }), afterBytes = bytes(call.input);
  assert(afterBytes < beforeBytes);
  t.diagnostic(`Fixed fixture ${stage} payload UTF-8 bytes: ${beforeBytes} -> ${afterBytes}; saved ${beforeBytes - afterBytes} bytes. This measures bytes, not tokens or quality.`);
});

test('HTTP copy reconstructs the exact task instructions and preserves model output while storing applied Skill versions', async t => {
  const p = projectFixture(), s = p.strategies[0], asset = p.assets[0];
  asset.prompt += '\n【人工追加】保留图中的橙色便签和原有措辞。';
  const beforePrompt = asset.prompt, beforeStrategy = structuredClone(s), f = await fixture(t, { project: p });
  const result = await f.req(`/projects/${p.id}/assets/${asset.id}/copy`, { expectedRevision: asset.revision, instruction: '保持说明清楚' });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const call = f.calls[0];
  assert.equal(call.input.strategy.prompt + '\n\n' + call.input.task.prompt, beforePrompt);
  assert(call.input.task.prompt.endsWith('【人工追加】保留图中的橙色便签和原有措辞。'));
  assert.equal(call.input.task.title, asset.title); assert.equal(call.input.task.body, asset.body);
  for (const key of ['title', 'body', 'prompt', 'scenes']) assert.deepEqual(result.data.result[key], copyOutput[key]);
  assert.deepEqual(f.project().strategies[0], beforeStrategy);
  assert.equal(call.storedPrompts[asset.id], beforePrompt, 'preparing the request must not mutate the saved task prompt');
  assert.deepEqual(call.reservedUsage.skillVersions, skillVersionsFor('copy', call.input));
  assert.deepEqual(f.project().usage.at(-1).skillVersions, call.reservedUsage.skillVersions);
  assert.deepEqual(result.data.result.skillTrace.builtin.map(({ id, version }) => ({ id, version })), call.reservedUsage.skillVersions.map(({ id, version }) => ({ id, version })));
  const beforeBytes = bytes({ ...call.input, task: { ...call.input.task, prompt: beforePrompt } }), afterBytes = bytes(call.input);
  assert(afterBytes < beforeBytes);
  t.diagnostic(`Fixed fixture copy payload UTF-8 bytes: ${beforeBytes} -> ${afterBytes}; saved ${beforeBytes - afterBytes} bytes. This measures bytes, not tokens or quality.`);
});

for (const modify of [text => '【人工前置指令】保持真实画面。\n' + text, text => text.replace('【原始策略规则】', '【人工修订规则】')]) test('HTTP copy preserves manually edited nonmatching task prefix', async t => {
  const p = projectFixture(), a = p.assets[0]; a.prompt = modify(a.prompt);
  const original = a.prompt, f = await fixture(t, { project: p });
  const result = await f.req(`/projects/${p.id}/assets/${a.id}/copy`, { expectedRevision: a.revision });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(f.calls[0].input.task.prompt, original);
  assert.equal(f.calls[0].storedPrompts[a.id], original);
});

for (const web of [false, true]) test(`${web ? 'web-prefiltered' : 'desktop'} HTTP copy retrieves with the confirmed brief after current project facts change`, async t => {
  const p = projectFixture(), a = p.assets[0], confirmed = structuredClone(p.strategies[0].briefSnapshot);
  p.brief = { ...p.brief, product: 'nebulakitchen', goal: 'selloven', facts: '本轮尚未确认的厨房设备资料。' };
  const expectedQuery = corpusQuery({ ...p, brief: confirmed }, `${a.title} `), expectedReferences = searchCorpus(p, expectedQuery);
  assert.deepEqual(expectedReferences.map(row => row.documentId), ['context-doc-0']);
  const path = `/projects/${p.id}/assets/${a.id}/copy`, body = { expectedRevision: a.revision };
  let state;
  if (web) {
    const temporary = createStore(':memory:'); const local = temporary.get(); temporary.close(); local.projects = [p];
    state = webPayload(local, path, body, p.id);
    assert.deepEqual(state.projects[0].corpus.map(doc => doc.id), ['context-doc-0'], 'browser must not discard confirmed-brief references before forwarding');
    assert.equal(p.corpus.length, 2, 'browser minimization must not mutate local corpus');
  }
  const f = await fixture(t, { project: p, state }), result = await f.req(path, body);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(f.calls[0].input.brief, confirmed);
  assert.equal(f.calls[0].input.retrievalQuery, expectedQuery);
  assert.deepEqual(f.calls[0].input.corpusReferences, expectedReferences);
  assert.deepEqual(result.data.result.corpusReferences, expectedReferences);
  assert.equal(f.project().brief.product, 'nebulakitchen', 'generation must not roll back the edited project brief');
});

test('metadata-only change to a previous strategy does not invalidate planning input', async t => {
  const f = await fixture(t, { onRequest: ({ store }) => store.mutate(state => { state.projects[0].strategies[0].copyReview.at = '2026-10-15T00:00:00.000Z'; }) });
  const result = await f.req(`/projects/${f.project().id}/strategies`, { mode: 'openai', stage: 'planning' });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(f.project().strategies.length, 2);
});

test('a real feedback edit during planning remains protected against stale model results', async t => {
  const f = await fixture(t, { onRequest: ({ store }) => store.mutate(state => { state.projects[0].experiences[0].text = '人工新反馈，必须保留'; }) });
  const result = await f.req(`/projects/${f.project().id}/strategies`, { mode: 'openai', stage: 'planning' });
  assert.equal(result.status, 409); assert.equal(f.project().strategies.length, 1);
  assert.equal(f.project().experiences[0].text, '人工新反馈，必须保留');
  assert.equal(f.project().usage.at(-1).status, 'completed');
  assert.deepEqual(f.project().usage.at(-1).skillVersions, f.calls[0].reservedUsage.skillVersions);
});
