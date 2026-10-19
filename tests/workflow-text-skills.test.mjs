import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, stageConfig } from '../server/models.mjs';
import { newProject, makeDraft, confirmStrategy } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';
import { COPY_SKILLS } from '../server/copy-skills.generated.mjs';
import { setBuiltinSkill } from '../server/builtin-skills.mjs';

const platforms = ['xiaohongshu', 'douyin', 'tiktok', 'youtube', 'instagram'];
const workflows = ['strategy', 'planning', ...platforms.map(id => `copy-${id}`), 'word-review', 'price-semantic', 'classification', 'analysis', 'document-context'];
const builtin = {
  strategy: ['marketing-strategy'], planning: ['iteration-planning'],
  ...Object.fromEntries(platforms.map(id => [`copy-${id}`, ['marketing-copywriting', ...(['xiaohongshu', 'douyin'].includes(id) ? [`${id}-copywriting`] : []), 'natural-copy-editing']])),
  'word-review': ['sensitive-copy-review'], 'price-semantic': ['price-context-replacement'], classification: ['comment-classification'], analysis: ['comment-insight-analysis'], 'document-context': ['document-context'],
};
const marker = id => `PRIVATE_${id.replaceAll('-', '_').toUpperCase()}_PREFERENCE：保留本步骤的原文依据。`;
const stageFor = workflow => workflow.startsWith('copy-') || ['word-review', 'price-semantic'].includes(workflow) ? 'copy' : workflow;
const quote = '预约需要提前一天办理，修改时间须联系客服。';
const vault = { status: () => ({ configured: true, supported: true }), getKey: async () => 'sk-synthetic-never-real' };
function install(state, workflowId, instructions = marker(workflowId), name = `test-${workflowId}`) {
  return installCreativeSkill(state, { workflowId, fileName: `${name}.md`, text: `---\nname: ${name}\ndescription: 测试用补充规则\nversion: 1.0.0\n---\n${instructions}`, expectedRevision: state.skillsRevision || 0, confirmed: true });
}
function outputFor(input) {
  if (input.documents) return { items: [{ kind: 'fact', text: quote, evidence: [{ documentId: input.documents[0].id, chunk: 1, quote }] }], missing: ['取消条件待补充'] };
  if (input.copyReview?.mode === 'semantic') return { decisions: input.copyReview.matches.map(item => ({ id: item.id, decision: 'replace', reason: '这是费用中的金额单位' })) };
  if (input.copyReview) return { title: input.copyReview.title.replaceAll('神级', '适合'), body: input.copyReview.body.replaceAll('神级', '适合') };
  if (input.comments && input.brief) return { insights: [{ category: '使用疑问', title: '补充改期说明', observation: '本次样本有人询问改期方式，仍需验证。', recommendation: '核对服务事实后补充说明', evidenceIds: [input.comments[0].id] }] };
  if (input.comments) return { comments: input.comments.map(comment => ({ id: comment.id, tags: ['使用疑问'], sentiment: 'neutral', reason: '原文询问操作方法', evidence: comment.text, needsReview: false })) };
  if (input.task) return { title: '预约前先看这些', body: '按已确认的预约条件选择时间。', prompt: '展示真实预约步骤', scenes: ['选择时间', '查看条件', '核对结果'] };
  return { title: '说清预约条件', core: '说明可预约的时段', direction: '围绕操作场景展开', prompt: '以已确认事实说明预约步骤' };
}
async function fixture(t, provider = 'openai', onRequest) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 29), scope: 'synthetic-workflow-text-skills' }), calls = [], models = createModelStore();
  if (provider !== 'openai') models.save(Object.fromEntries(Object.keys(models.get()).map(stage => [stage, provider === 'deepseek' ? 'deepseek-v4-pro' : 'qwen-plus'])));
  const project = newProject({ name: '合成预约项目', brand: '测试品牌', product: '预约工具', type: 'launch', goal: '说明预约步骤', audience: '需要预约自习的用户', sellingPoints: '预约步骤清楚', facts: quote, requirements: '简洁准确', channels: platforms, deadline: '2026-11-01', budgetUsd: 100 });
  const strategy = makeDraft(project, {}, '', 'demo', []); confirmStrategy(project, strategy.id, []);
  const document = importCorpus(project, { name: '预约条件介绍', text: quote, format: 'txt' });
  project.comments = [{ id: 'synthetic-comment', publicationId: 'synthetic-published', strategyId: strategy.id, accountName: '合成账号', platform: 'xiaohongshu', text: '预约之后可以修改时间吗？', tags: ['使用疑问'], sentiment: 'neutral', source: 'manual', importedAt: '2026-10-16T00:00:00.000Z', irrelevant: false, sample: false }];
  store.mutate(state => { state.projects = [project]; state.contentRules = [
    { id: 'word-rewrite', term: '神级', replacement: '', action: 'rewrite', risk: 'A', enabled: true },
    { id: 'semantic-yuan', term: '元', replacement: '圆', action: 'semantic', risk: 'PRICE', enabled: true },
  ]; });
  const app = createApp(store, { profileMode: true, apiKey: 'synthetic-api-key', deepseekVault: vault, qwenVault: vault, modelStore: models, fetcher: async (url, init) => {
    const request = JSON.parse(init.body), input = JSON.parse(provider === 'openai' ? request.input : request.messages.find(item => item.role === 'user').content);
    const instructions = provider === 'openai' ? request.instructions : request.messages.find(item => item.role === 'system').content;
    const usage = structuredClone(store.get().projects[0].usage.at(-1));
    calls.push({ url, request, input, instructions, usage });
    await onRequest?.({ store, input });
    const text = JSON.stringify(outputFor(input));
    return provider === 'openai' ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }], usage: { input_tokens: 120, output_tokens: 60 } }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 120, completion_tokens: 60 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const p = () => store.get().projects[0];
  const req = async (path, body, method = 'POST') => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, data: await result.json() };
  };
  const select = async (workflowId, skillId) => req('/creative-skills/selection', { workflowId, skillId, expectedRevision: store.get().skillsRevision }, 'PUT');
  const run = workflowId => {
    const base = `/projects/${p().id}`;
    if (['strategy', 'planning'].includes(workflowId)) return req(base + '/strategies', { mode: 'openai', stage: workflowId });
    if (workflowId === 'document-context') return req(base + '/corpus/context', { documentIds: [document.id], confirmed: true });
    if (workflowId === 'classification') return req(base + '/comments/classify', { commentIds: ['synthetic-comment'] });
    if (workflowId === 'analysis') return req(base + '/analysis', { mode: 'openai', commentIds: ['synthetic-comment'] });
    const asset = p().assets.find(item => item.channel === (workflowId.startsWith('copy-') ? workflowId.slice(5) : 'xiaohongshu'));
    const body = { expectedRevision: asset.revision };
    if (['word-review', 'price-semantic'].includes(workflowId)) Object.assign(body, { reviewOnly: true, reviewMode: workflowId === 'word-review' ? 'words' : 'semantic', rulesRevision: store.get().rulesRevision || 0, draft: workflowId === 'word-review' ? { title: '神级学习环境', body: '保留真实预约条件' } : { title: '预约体验', body: '体验费用19.9元。' } });
    return req(base + `/assets/${asset.id}/copy`, body);
  };
  return { store, calls, p, req, select, run, models };
}

for (const provider of ['openai', 'deepseek', 'qwen']) for (const workflowId of workflows) test(`${provider}: edited defaults for ${workflowId} reach only its request and exact billed trace`, async t => {
  const f = await fixture(t, provider);
  f.store.mutate(state => {
    for (const id of workflows) setBuiltinSkill(state, { workflowId: id, skillId: builtin[id][0], instructions: `EDITED_DEFAULT_${id}_ONLY`, expectedRevision: state.skillsRevision });
  });
  const result = await f.run(workflowId);
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(f.calls.length, 1);
  const call = f.calls[0], target = `EDITED_DEFAULT_${workflowId}_ONLY`;
  assert(call.instructions.includes(target)); assert(!call.instructions.includes(COPY_SKILLS[builtin[workflowId][0]]));
  assert.equal(call.input.builtinSkills, undefined, 'default instructions should not be billed twice');
  for (const id of workflows.filter(id => id !== workflowId)) assert(!JSON.stringify(call.request).includes(`EDITED_DEFAULT_${id}_ONLY`));
  const trace = f.p().usage.at(-1).skillTrace;
  assert.equal(trace.workflowId, workflowId); assert.equal(trace.builtin[0].instructions, target);
  assert.match(trace.builtin[0].version, /local\./);
  assert.deepEqual(trace, call.usage.skillTrace, 'settlement must retain the exact prompt snapshot');
  assert(!Object.hasOwn(call.input, 'builtinSkillOverrides'));
});

test('editing and resetting a default while a text job runs preserves that job and applies to the next request', async t => {
  let release, enter; const gate = new Promise(done => { release = done; }), started = new Promise(done => { enter = done; });
  let first = true;
  const f = await fixture(t, 'deepseek', async () => { if (first) { first = false; enter(); await gate; } });
  const save = instructions => f.req('/creative-skills/default', { workflowId: 'strategy', skillId: 'marketing-strategy', instructions, expectedRevision: f.store.get().skillsRevision }, 'PUT');
  assert.equal((await save('ORIGINAL_DEFAULT_RULE')).status, 200);
  const pending = f.run('strategy'); await started;
  try { assert.equal((await save('NEXT_DEFAULT_RULE')).status, 200); } finally { release(); }
  assert.equal((await pending).status, 200);
  assert(f.calls[0].instructions.includes('ORIGINAL_DEFAULT_RULE')); assert(!f.calls[0].instructions.includes('NEXT_DEFAULT_RULE'));
  assert.equal(f.p().usage[0].skillTrace.builtin[0].instructions, 'ORIGINAL_DEFAULT_RULE');
  assert.equal((await f.run('strategy')).status, 200); assert(f.calls[1].instructions.includes('NEXT_DEFAULT_RULE'));
  const before = f.store.get().skillsRevision;
  const stale = await f.req('/creative-skills/default', { workflowId: 'strategy', skillId: 'marketing-strategy', expectedRevision: before - 1 }, 'DELETE');
  assert.equal(stale.status, 409); assert.equal(f.store.get().skillsRevision, before);
  assert.equal((await f.req('/creative-skills/default', { workflowId: 'strategy', skillId: 'marketing-strategy', expectedRevision: before }, 'DELETE')).status, 200);
  assert.equal((await f.run('strategy')).status, 200); assert(f.calls[2].instructions.includes(COPY_SKILLS['marketing-strategy']));
  assert(!f.calls[2].instructions.includes('NEXT_DEFAULT_RULE'));
  assert.equal(f.p().usage[0].skillTrace.builtin[0].instructions, 'ORIGINAL_DEFAULT_RULE');
});

for (const provider of ['openai', 'deepseek', 'qwen']) for (const workflowId of workflows) test(`${provider}: central ${workflowId} selection is isolated, keeps builtin rules, and is included in billed-input estimate`, async t => {
  const f = await fixture(t, provider), installed = {};
  f.store.mutate(state => { for (const id of workflows) { installed[id] = install(state, id); if (id !== workflowId) state.skillSelections[id] = installed[id].id; } });
  const selected = await f.select(workflowId, installed[workflowId].id); assert.equal(selected.status, 200, JSON.stringify(selected.data));
  const result = await f.run(workflowId); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(f.calls.length, 1);
  const call = f.calls[0], text = JSON.stringify(call.request), compact = call.input.creativeSkill;
  assert.deepEqual(compact, { id: installed[workflowId].id, name: installed[workflowId].name, version: '1.0.0', workflowId, instructions: marker(workflowId) });
  for (const other of workflows.filter(id => id !== workflowId)) assert(!text.includes(marker(other)), `${other} leaked into ${workflowId}`);
  assert(!text.includes('installedSkills')); assert(!text.includes('sourceText'));
  assert.match(call.instructions, /不得改变接口字段/);
  for (const [id, body] of Object.entries(COPY_SKILLS)) assert.equal(call.instructions.includes(body), builtin[workflowId].includes(id), `builtin scope for ${workflowId}: ${id}`);
  assert.deepEqual(call.usage.skillTrace.user, compact); assert.equal(call.usage.skillTrace.workflowId, workflowId);
  const route = stageConfig(stageFor(workflowId), f.models.get());
  const inputUpperBound = Buffer.byteLength(call.instructions + JSON.stringify(call.input), 'utf8') + 2500;
  assert.equal(call.usage.amountUsd, (inputUpperBound * route.inputPrice + route.maxTokens * route.outputPrice) / 1e6);
  assert.equal(f.p().usage.at(-1).status, 'completed');
  assert.deepEqual(f.p().usage.at(-1).skillTrace.user, compact);
  if (workflowId === 'price-semantic') assert.match(result.data.result.candidate.body, /19\.9圆/);
  if (workflowId === 'document-context') assert.equal(result.data.result.items[0].evidence[0].quote, quote);
});

test('central selection can change during text generation without replacing the in-flight frozen Skill', async t => {
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  let firstCall = true;
  const f = await fixture(t, 'deepseek', async () => { if (firstCall) { firstCall = false; entered(); await wait; } });
  let first, second;
  f.store.mutate(state => { first = install(state, 'strategy', 'FIRST_FROZEN_STRATEGY_RULE', 'first-rule'); second = install(state, 'strategy', 'NEXT_STRATEGY_RULE', 'second-rule'); });
  assert.equal((await f.select('strategy', first.id)).status, 200);
  const pending = f.run('strategy');
  await ready;
  try { assert.equal((await f.select('strategy', second.id)).status, 200); } finally { release(); }
  const result = await pending; assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.result.skillTrace.user.id, first.id);
  assert.equal(f.calls[0].input.creativeSkill.instructions, 'FIRST_FROZEN_STRATEGY_RULE');
  assert.equal(f.p().usage[0].skillTrace.user.id, first.id);
  const next = await f.run('strategy'); assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.equal(f.calls[1].input.creativeSkill.instructions, 'NEXT_STRATEGY_RULE');
  assert(!JSON.stringify(f.calls[1].request).includes('FIRST_FROZEN_STRATEGY_RULE'));
});

test('restoring default retains historical trace and separate local workspaces never borrow selections', async t => {
  const one = await fixture(t), two = await fixture(t); let selected;
  one.store.mutate(state => { selected = install(state, 'copy-xiaohongshu', 'WORKSPACE_ONE_COPY_RULE'); });
  assert.equal((await one.select('copy-xiaohongshu', selected.id)).status, 200);
  const result = await one.run('copy-xiaohongshu'); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(one.calls[0].input.creativeSkill.id, selected.id);
  assert.equal((await two.run('copy-xiaohongshu')).status, 200);
  assert.equal(two.calls[0].input.creativeSkill, null); assert(!JSON.stringify(two.calls[0].request).includes('WORKSPACE_ONE_COPY_RULE'));
  assert.equal((await one.select('copy-xiaohongshu', '')).status, 200);
  assert.equal((await one.run('copy-xiaohongshu')).status, 200);
  assert.equal(one.calls[1].input.creativeSkill, null); assert(!JSON.stringify(one.calls[1].request).includes('WORKSPACE_ONE_COPY_RULE'));
  assert.equal(one.p().usage[0].skillTrace.user.id, selected.id); assert.equal(one.p().usage[1].skillTrace.user, null);
  assert.equal(one.store.get().installedSkills.length, 1, 'restoring the default must not delete the imported Skill');
});

test('a large selected rule counts toward text budget and cannot trigger an underfunded model request', async t => {
  const f = await fixture(t); let selected;
  f.store.mutate(state => { selected = install(state, 'strategy', 'LONG_PRIVATE_RULE_' + 'X'.repeat(20000)); state.projects[0].brief.budgetUsd = .01; });
  assert.equal((await f.select('strategy', selected.id)).status, 200);
  const result = await f.run('strategy'); assert.equal(result.status, 400); assert.match(JSON.stringify(result.data), /预算|余额/);
  assert.equal(f.calls.length, 0); assert.equal(f.p().usage.length, 0);
});
