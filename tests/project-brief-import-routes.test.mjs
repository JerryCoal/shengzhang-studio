import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { newProject } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';
import { COPY_SKILLS } from '../server/copy-skills.generated.mjs';
import { briefImportConfig } from '../server/project-brief-import.mjs';
import { setBuiltinSkill } from '../server/builtin-skills.mjs';

const FIELDS = ['name', 'brand', 'product', 'goal', 'audience', 'sellingPoints', 'facts', 'requirements'];
const KEY = 'sk-synthetic-brief-import-no-network-000000000';
const QUOTE = '青芽提供校内学习搭子匹配，面向需要共同自习的大学生。';
const PRIVATE_TAIL = 'WHOLE_DOCUMENT_PRIVATE_TAIL_这段未被引用的介绍正文不应保存在任务记录。';
const TEXT = `${QUOTE}\n项目希望让更多大学生了解预约共同自习的方式。\n${PRIVATE_TAIL}`;
const SOURCE = { sourceName: '青芽介绍.txt', text: TEXT };
const result = () => ({ fields: [
  { field: 'brand', value: '青芽', evidence: [QUOTE] },
  { field: 'product', value: '校内学习搭子匹配', evidence: [QUOTE] },
  { field: 'audience', value: '需要共同自习的大学生', evidence: [QUOTE] },
  { field: 'facts', value: QUOTE, evidence: [QUOTE] },
], warnings: ['价格、时间与活动预算未在文档中说明，请自行补充。'] });
const brief = () => ({ name: 'OLD_PROJECT_PRIVATE_NAME', brand: 'OLD_BRAND_PRIVATE', product: '原有产品', type: 'launch', goal: '原有目标', audience: '原有人群', sellingPoints: '原有卖点', facts: 'OLD_PROJECT_PRIVATE_FACTS', requirements: '原有表达要求', channels: ['xiaohongshu'], deadline: '2026-11-20', budgetUsd: 10 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 83), scope: 'synthetic-brief-import-routes' });
  const p = newProject(brief());
  importCorpus(p, { name: '未选择的语料', text: 'UNSELECTED_CORPUS_PRIVATE_SENTINEL，不得作为当前文档发送。' });
  store.mutate(state => { state.projects = [p]; });
  const calls = [];
  const config = { profileMode: true, deepseekVault: { status: () => ({ configured: true }), getKey: async () => KEY }, ...(options.config || {}), fetcher: async (url, init) => {
    const request = JSON.parse(init.body || '{}');
    const input = JSON.parse(request.messages?.find(message => message.role === 'user')?.content || '{}');
    calls.push({ url: String(url), request, input });
    await options.onRequest?.({ store, request, input });
    if (options.response) return options.response(input);
    const value = options.output ? options.output(input) : result();
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 120, completion_tokens: 80 } });
  } };
  let app, server;
  const start = async () => { app = createApp(store, config); server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); };
  const stop = async () => { await app.locals.integrations.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  t.after(async () => { await stop(); store.close(); });
  const req = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const draft = async (editorKey = 'new', value = brief(), expectedVersion = 0, baseBrief) => {
    const response = await req(`/editor-drafts/${editorKey}`, { brief: value, expectedVersion, ...(editorKey === 'new' ? {} : { baseBrief: baseBrief || store.get().projects.find(project => project.id === editorKey).brief }) }, 'PUT');
    assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.draft;
  };
  const run = (editorKey = 'new', extra = {}) => req('/brief-import', { editorKey, ...SOURCE, requestId: randomUUID(), confirmed: true, ...extra });
  return { store, calls, p, req, draft, run, restart: async () => { await stop(); await start(); }, jobs: () => store.get().briefImports || [], current: () => store.get().projects.find(project => project.id === p.id) };
}

test('brief import uses an edited default without leaking unrelated default rules', async t => {
  const f = await fixture(t);
  f.store.mutate(state => {
    setBuiltinSkill(state, { workflowId: 'brief-import', skillId: 'project-brief-import', instructions: 'EDITED_BRIEF_IMPORT_ONLY', expectedRevision: state.skillsRevision });
    setBuiltinSkill(state, { workflowId: 'strategy', skillId: 'marketing-strategy', instructions: 'UNRELATED_STRATEGY_DEFAULT', expectedRevision: state.skillsRevision });
  });
  await f.draft();
  const response = await f.run(); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(f.calls.length, 1);
  const prompt = f.calls[0].request.messages[0].content;
  assert(prompt.includes('EDITED_BRIEF_IMPORT_ONLY')); assert(!JSON.stringify(f.calls[0].request).includes('UNRELATED_STRATEGY_DEFAULT'));
  assert(!prompt.includes(COPY_SKILLS['project-brief-import']));
  assert.equal(f.jobs().at(-1).skillTrace.builtin[0].instructions, 'EDITED_BRIEF_IMPORT_ONLY');
});

test('brief import status and estimate are read-only and do not call a provider', async t => {
  const f = await fixture(t);
  await f.draft();
  const status = await f.req('/brief-import?editorKey=new', undefined, 'GET');
  assert.equal(status.status, 200, JSON.stringify(status.data));
  assert.equal(status.data.job, null); assert.equal(status.data.configured, true); assert.match(status.data.model, /^deepseek-/);
  const estimate = await f.req('/brief-import/estimate', { editorKey: 'new', ...SOURCE });
  assert.equal(estimate.status, 200, JSON.stringify(estimate.data)); assert(estimate.data.reservationUsd > 0); assert.match(estimate.data.model, /^deepseek-/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.jobs(), []);
});

test('brief import only sends the selected document to DeepSeek and leaves manual fields unchanged', async t => {
  const f = await fixture(t); await f.draft(f.p.id);
  const before = f.current().brief;
  const response = await f.run(f.p.id);
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(f.calls.length, 1);
  const sent = f.calls[0]; assert.equal(new URL(sent.url).origin, 'https://api.deepseek.com'); assert.equal(new URL(sent.url).pathname, '/chat/completions');
  assert.match(sent.request.model, /^deepseek-/); assert.match(JSON.stringify(sent.input), /青芽提供校内学习搭子匹配/);
  assert.doesNotMatch(JSON.stringify(sent.request), /OLD_PROJECT_PRIVATE|OLD_BRAND_PRIVATE|UNSELECTED_CORPUS_PRIVATE_SENTINEL/);
  assert.deepEqual(f.current().brief, before); assert.deepEqual(f.store.get().projectDrafts[f.p.id].brief, before);
  const job = response.data.job;
  assert.equal(job.status, 'completed'); assert.equal(job.editorKey, f.p.id); assert.equal(job.sourceName, SOURCE.sourceName);
  assert.deepEqual(Object.keys(job.baseline).sort(), [...FIELDS].sort());
  for (const field of FIELDS) assert.equal(job.baseline[field], before[field]);
  assert.deepEqual(job.result.fields, result().fields); assert(job.amountUsd > 0); assert.equal(job.estimated, false);
  assert.equal(f.current().usage.length, 1); assert.equal(f.current().usage[0].amountUsd, job.amountUsd);
  const saved = await f.req(`/brief-import?editorKey=${f.p.id}`, undefined, 'GET');
  assert.equal(saved.data.job.id, job.id); assert.doesNotMatch(JSON.stringify(saved.data), new RegExp(KEY));
  assert.doesNotMatch(JSON.stringify(f.store.get()), /WHOLE_DOCUMENT_PRIVATE_TAIL/);
});

test('new draft import retains a candidate and charges without creating a project', async t => {
  const f = await fixture(t); const initial = { ...brief(), name: '' }; await f.draft('new', initial);
  const response = await f.run();
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(f.store.get().projects.length, 1);
  assert.deepEqual(f.store.get().projectDrafts.new.brief, initial); assert.equal(f.current().usage.length, 0);
  assert.equal(f.jobs().length, 1); assert(f.jobs()[0].amountUsd > 0); assert.equal(f.jobs()[0].editorKey, 'new');
  assert.doesNotMatch(JSON.stringify(response.data), /WHOLE_DOCUMENT_PRIVATE_TAIL/);
});

test('invalid evidence rejects the model result while retaining returned charges', async t => {
  const f = await fixture(t, { output: () => { const value = result(); value.fields[0].evidence = ['这是完全不存在于所选文档中的引用']; return value; } });
  await f.draft(f.p.id); const before = f.current().brief;
  const response = await f.run(f.p.id);
  assert.equal(response.status, 502, JSON.stringify(response.data)); assert.equal(f.calls.length, 1);
  const job = f.jobs().at(-1); assert(job.amountUsd > 0); assert.equal(job.estimated, false); assert.notEqual(job.status, 'completed'); assert(!job.result);
  assert.deepEqual(f.current().brief, before); assert(f.current().usage[0].amountUsd > 0);
  assert.doesNotMatch(JSON.stringify(f.store.get()), /完全不存在于所选文档/);
});

test('a provider billing rejection releases the reservation and repeated request does not retry', async t => {
  const f = await fixture(t, { response: () => Response.json({ error: 'provider body must not be persisted' }, { status: 402 }) });
  await f.draft(f.p.id); const requestId = randomUUID();
  const first = await f.run(f.p.id, { requestId }); assert.equal(first.status, 502);
  const job = f.jobs()[0]; assert.equal(job.status, 'failed'); assert.equal(job.amountUsd, 0); assert.equal(job.estimated, false);
  assert.equal(f.current().usage[0].amountUsd, 0); assert.doesNotMatch(JSON.stringify(f.store.get()), /provider body must not/);
  const repeat = await f.run(f.p.id, { requestId }); assert.equal(repeat.status, 200); assert.equal(repeat.data.job.id, requestId); assert.equal(repeat.data.job.status, 'failed'); assert.equal(f.calls.length, 1);
});

test('a network interruption retains the reservation and does not retry automatically', async t => {
  const f = await fixture(t, { onRequest: () => { throw new Error('synthetic network interruption'); } });
  await f.draft();
  const estimate = await f.req('/brief-import/estimate', { editorKey: 'new', ...SOURCE });
  const first = await f.run(); assert.equal(first.status, 502);
  const job = f.jobs()[0]; assert.equal(job.status, 'uncertain'); assert.equal(job.amountUsd, estimate.data.reservationUsd); assert.equal(job.estimated, true); assert.equal(f.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(f.store.get()), /synthetic network interruption|WHOLE_DOCUMENT_PRIVATE_TAIL/);
});

test('missing DeepSeek key, consent or editor draft prevents any external request', async t => {
  const noKey = await fixture(t, { config: { deepseekVault: { status: () => ({ configured: false }), getKey: async () => { throw new Error('must not request a missing key'); } } } });
  await noKey.draft();
  assert.equal((await noKey.req('/brief-import?editorKey=new', undefined, 'GET')).data.configured, false);
  assert.equal((await noKey.run()).status, 400); assert.equal(noKey.calls.length, 0);
  const f = await fixture(t); assert.equal((await f.run()).status, 400); await f.draft();
  assert.equal((await f.run('new', { confirmed: false })).status, 400); assert.equal(f.calls.length, 0); assert.deepEqual(f.jobs(), []);
});

test('document character and byte limits, empty input and zero budget fail before provider use', async t => {
  const f = await fixture(t); await f.draft();
  for (const text of [' ', 'a'.repeat(30001), '中'.repeat(20001)]) {
    const response = await f.run('new', { text }); assert.equal(response.status, 400, `input length ${text.length}: ${JSON.stringify(response.data)}`);
  }
  await f.draft('new', { ...brief(), budgetUsd: 0 }, 1);
  assert.equal((await f.run()).status, 400); assert.equal(f.calls.length, 0); assert.deepEqual(f.jobs(), []);
});

test('brief extraction is restricted to the local encrypted profile and never relayed', async t => {
  for (const config of [{ profileMode: false }, { authorizeCredentials: () => true }]) {
    const f = await fixture(t, { config }); await f.draft();
    assert.equal((await f.run()).status, 403); assert.equal(f.calls.length, 0); assert.deepEqual(f.jobs(), []);
  }
});

test('request identity makes repeat submission idempotent and rejects changed document content', async t => {
  const f = await fixture(t); await f.draft(); const requestId = randomUUID();
  const first = await f.run('new', { requestId }); assert.equal(first.status, 200, JSON.stringify(first.data));
  const repeat = await f.run('new', { requestId }); assert.equal(repeat.status, 200, JSON.stringify(repeat.data));
  assert.equal(repeat.data.job.id, first.data.job.id); assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
  const changed = await f.run('new', { requestId, text: `${TEXT}\n改变了原文` });
  assert.equal(changed.status, 409); assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
});

test('concurrent requests for the same editor are rejected and an in-flight draft cannot become a project', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { onRequest: async () => { entered.resolve(); await release.promise; } });
  await f.draft(); const requestId = randomUUID(), pending = f.run('new', { requestId });
  await entered.promise;
  try {
    const repeat = await f.run('new', { requestId }); assert.equal(repeat.status, 200); assert.equal(repeat.data.job.status, 'running');
    assert.equal((await f.run()).status, 409);
    const creation = await f.req('/projects', { ...brief(), editorDraftVersion: 1 });
    assert.equal(creation.status, 409); assert.equal(f.store.get().projects.length, 1); assert(f.store.get().projectDrafts.new);
  } finally { release.resolve(); }
  assert.equal((await pending).status, 200); assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
});

test('new-project imports share the draft budget across separate requests', async t => {
  const f = await fixture(t); await f.draft();
  const estimate = await f.req('/brief-import/estimate', { editorKey: 'new', ...SOURCE }); assert.equal(estimate.status, 200, JSON.stringify(estimate.data));
  const first = await f.run(); assert.equal(first.status, 200, JSON.stringify(first.data));
  const reducedBudget = first.data.job.amountUsd + estimate.data.reservationUsd / 2;
  await f.draft('new', { ...brief(), budgetUsd: reducedBudget }, 1);
  assert.equal((await f.run()).status, 400); assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
});

test('manual edits made during extraction survive and the candidate keeps its original baseline', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { onRequest: async () => { entered.resolve(); await release.promise; } });
  const initial = brief(); await f.draft('new', initial); const pending = f.run(); await entered.promise;
  try { await f.draft('new', { ...initial, product: '等待时手工补充的产品信息' }, 1); } finally { release.resolve(); }
  const response = await pending; assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.job.baseline.product, initial.product); assert.equal(f.store.get().projectDrafts.new.brief.product, '等待时手工补充的产品信息');
  assert.equal(f.calls.length, 1);
});

test('creating the project transfers import expenses and their provenance from the new draft once', async t => {
  const f = await fixture(t); await f.draft(); const extracted = await f.run(); assert.equal(extracted.status, 200, JSON.stringify(extracted.data));
  const amount = extracted.data.job.amountUsd, jobId = extracted.data.job.id;
  const created = await f.req('/projects', { ...brief(), name: '新建并关联费用的项目', editorDraftVersion: 1 });
  assert.equal(created.status, 201, JSON.stringify(created.data)); const p = created.data.result;
  assert.equal(p.usage.length, 1); assert.equal(p.usage[0].amountUsd, amount);
  assert.equal(f.jobs().find(job => job.id === jobId).editorKey, p.id);
  assert.equal(f.store.get().projectDrafts.new, undefined);
  assert.equal((await f.req('/brief-import?editorKey=new', undefined, 'GET')).data.job, null);
  assert.equal((await f.req('/projects', { ...brief(), editorDraftVersion: 1 })).status, 409);
});

test('restart marks an interrupted import as uncertain without refunding or replaying its request', async t => {
  const f = await fixture(t); await f.draft(); const extracted = await f.run(); assert.equal(extracted.status, 200, JSON.stringify(extracted.data));
  const jobId = extracted.data.job.id, amount = extracted.data.job.amountUsd;
  f.store.mutate(state => { const job = state.briefImports.find(item => item.id === jobId); job.status = 'running'; job.estimated = true; delete job.result; });
  await f.restart();
  const status = await f.req('/brief-import?editorKey=new', undefined, 'GET');
  assert.equal(status.status, 200); assert.equal(status.data.job.status, 'uncertain'); assert.equal(status.data.job.amountUsd, amount); assert.equal(status.data.job.estimated, true);
  assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
});

function installBriefSkill(state, workflowId, name, instructions) {
  return installCreativeSkill(state, { workflowId, fileName: `${name}.md`, text: `---\nname: ${name}\nversion: 1.0.0\n---\n${instructions}`, expectedRevision: state.skillsRevision || 0, confirmed: true });
}
async function chooseBriefSkill(f, skillId) {
  const selected = await f.req('/creative-skills/selection', { workflowId: 'brief-import', skillId, expectedRevision: f.store.get().skillsRevision }, 'PUT');
  assert.equal(selected.status, 200, JSON.stringify(selected.data));
}

test('brief import uses only its centrally selected rule with builtin instructions and includes it in the estimate', async t => {
  let reserved;
  const f = await fixture(t, { onRequest: ({ store }) => { reserved = store.get().briefImports.at(-1).amountUsd; } });
  await f.draft(f.p.id);
  const originalEstimate = await f.req('/brief-import/estimate', { editorKey: f.p.id, ...SOURCE }); assert.equal(originalEstimate.status, 200);
  const selectedText = 'BRIEF_IMPORT_PRIVATE_SELECTED_RULE：保留原文中的限制条件。\n' + '附加说明必须忠于当前介绍文档。'.repeat(100);
  let selected;
  f.store.mutate(state => {
    selected = installBriefSkill(state, 'brief-import', 'brief-selected', selectedText);
    const unrelated = installBriefSkill(state, 'document-context', 'document-other', 'UNRELATED_DOCUMENT_RULE_MUST_STAY_LOCAL');
    state.skillSelections['document-context'] = unrelated.id;
  });
  await chooseBriefSkill(f, selected.id);
  const estimate = await f.req('/brief-import/estimate', { editorKey: f.p.id, ...SOURCE }); assert.equal(estimate.status, 200);
  assert(estimate.data.reservationUsd > originalEstimate.data.reservationUsd);
  assert.equal(f.calls.length, 0, 'estimation must not call a model');
  const response = await f.run(f.p.id); assert.equal(response.status, 200, JSON.stringify(response.data));
  const sent = f.calls[0], instructions = sent.request.messages.find(message => message.role === 'system').content;
  assert(instructions.includes(COPY_SKILLS['project-brief-import'])); assert(instructions.includes(JSON.stringify(selectedText)));
  assert(!instructions.includes(COPY_SKILLS['document-context'])); assert(!JSON.stringify(sent.request).includes('UNRELATED_DOCUMENT_RULE_MUST_STAY_LOCAL'));
  assert.deepEqual(sent.input, SOURCE);
  assert.doesNotMatch(JSON.stringify(sent.request), /OLD_PROJECT_PRIVATE|OLD_BRAND_PRIVATE|UNSELECTED_CORPUS_PRIVATE_SENTINEL/);
  assert.equal(reserved, estimate.data.reservationUsd);
  const expected = ((Buffer.byteLength(instructions + JSON.stringify(sent.input), 'utf8') + 2500) * briefImportConfig.inputPrice + briefImportConfig.maxTokens * briefImportConfig.outputPrice) / 1e6;
  assert.equal(reserved, expected);
  assert.equal(response.data.job.skillTrace.user.id, selected.id); assert.equal(response.data.job.skillTrace.user.instructions, selectedText);
  assert.equal(f.current().usage[0].skillTrace.user.id, selected.id);
  assert.doesNotMatch(JSON.stringify(f.store.get()), /WHOLE_DOCUMENT_PRIVATE_TAIL/);
});

test('pending brief import freezes its Skill even when central settings change or restore default', async t => {
  const entered = deferred(), release = deferred(); let firstCall = true;
  const f = await fixture(t, { onRequest: async () => { if (firstCall) { firstCall = false; entered.resolve(); await release.promise; } } });
  await f.draft(); let first, next;
  f.store.mutate(state => { first = installBriefSkill(state, 'brief-import', 'brief-first', 'FROZEN_FIRST_BRIEF_RULE'); next = installBriefSkill(state, 'brief-import', 'brief-next', 'NEXT_BRIEF_RULE'); });
  await chooseBriefSkill(f, first.id);
  const pending = f.run(); await entered.promise;
  try { await chooseBriefSkill(f, next.id); } finally { release.resolve(); }
  const response = await pending; assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.job.skillTrace.user.id, first.id); assert(JSON.stringify(f.calls[0].request).includes('FROZEN_FIRST_BRIEF_RULE'));
  assert(!JSON.stringify(f.calls[0].request).includes('NEXT_BRIEF_RULE'));
  const second = await f.run(); assert.equal(second.status, 200); assert.equal(second.data.job.skillTrace.user.id, next.id);
  assert(JSON.stringify(f.calls[1].request).includes('NEXT_BRIEF_RULE'));
  await chooseBriefSkill(f, '');
  const third = await f.run(); assert.equal(third.status, 200); assert.equal(third.data.job.skillTrace.user, null);
  assert.doesNotMatch(JSON.stringify(f.calls[2].request), /FROZEN_FIRST_BRIEF_RULE|NEXT_BRIEF_RULE/);
  assert(f.calls[2].request.messages[0].content.includes(COPY_SKILLS['project-brief-import']));
  assert.equal(f.jobs()[0].skillTrace.user.id, first.id, 'historical snapshot survives a default reset');
});

test('a larger selected brief Skill cannot exceed the draft budget that only covered the default', async t => {
  const f = await fixture(t); await f.draft();
  const estimate = await f.req('/brief-import/estimate', { editorKey: 'new', ...SOURCE }); assert.equal(estimate.status, 200);
  await f.draft('new', { ...brief(), budgetUsd: estimate.data.reservationUsd + .000001 }, 1);
  let selected; f.store.mutate(state => { selected = installBriefSkill(state, 'brief-import', 'brief-large', 'LARGE_BRIEF_RULE_' + 'X'.repeat(15000)); });
  await chooseBriefSkill(f, selected.id);
  const rejected = await f.run(); assert.equal(rejected.status, 400); assert.match(JSON.stringify(rejected.data), /费用上限不足/);
  assert.equal(f.calls.length, 0); assert.equal(f.jobs().length, 0);
});
