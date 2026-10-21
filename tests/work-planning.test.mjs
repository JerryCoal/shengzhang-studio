import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';
import { createWorkPlanner } from '../server/work-planning.mjs';

const actor = { userId: 'planner-owner', role: 'editor' };
const secret = 'PLANNER_SYNTHETIC_KEY_NOT_TO_BE_PERSISTED';
const proposal = () => ({ kind: 'proposal', goal: '为指定账号准备 AI 教育内容', question: '', nodes: [
  { id: 'copy', role: 'xiaohongshu-copy', title: '校园图文', accountId: 'xhs-a', connectionAccountId: '', requirement: '写 AI 教育课堂观察', dependsOn: [] },
  { id: 'research', role: 'douyin-research', title: '公开同话题研究', accountId: '', connectionAccountId: 'dy-b', requirement: 'AI 教育', dependsOn: [] },
  { id: 'script', role: 'douyin-script', title: '品牌脚本', accountId: 'dy-b', connectionAccountId: '', requirement: '根据研究写 AI 教育视频脚本', dependsOn: ['research'] },
] });
const reply = (value, usage = { input_tokens: 150, output_tokens: 120 }) => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], ...(usage ? { usage } : {}) });
function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 31), scope: 'planning-synthetic' }), requests = [];
  store.mutate(state => { state.accounts = [
    { id: 'xhs-a', platform: 'xiaohongshu', name: '校园 A', creationProfile: { revision: 1, identityMarkdown: 'PRIVATE_IDENTITY_NOT_NEEDED_FOR_PLANNING', identityFileName: '', presets: [], defaultPresetId: '' } },
    { id: 'dy-b', platform: 'douyin', name: '品牌 B', mcpAccountId: 'dy-reader' },
    { id: 'dy-not-selected', platform: 'douyin', name: '其他私有账号', mcpAccountId: 'other-reader' },
  ]; state.projects[0].brief.budgetUsd = 100; state.agentWorkspace = { revision: 0, drafts: { private: { conversation: 'PRIVATE_OTHER_CHAT_NEVER_INCLUDE' } } }; });
  const config = { apiKey: secret, modelStore: createModelStore(), authorizeWorkActor: candidate => candidate?.userId === actor.userId, workFetcher: async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses', 'mock never forwards unknown URLs');
    const request = JSON.parse(init.body), payload = JSON.parse(request.input); requests.push({ request, payload });
    return options.fetcher ? options.fetcher(payload, requests.length) : reply(options.output ? options.output(payload) : proposal(), options.noUsage ? null : undefined);
  }, ...options.config };
  const planner = createWorkPlanner({ store, config }), projectId = store.get().projects[0].id;
  t.after(() => store.close());
  const prepare = async (changes = {}) => {
    const input = planner.prepare({ projectId, goal: '为校园号写小红书图文，研究抖音后给品牌号写脚本', accountIds: ['xhs-a', 'dy-b'], model: 'gpt-5.4-mini', planningBudgetUSD: 1, ...changes });
    return { ...input, ...await planner.prepareConnection({ actor, input }) };
  };
  const execute = async (changes = {}) => {
    const input = changes.input || await prepare(), run = changes.run || { id: randomUUID(), projectId, ownerId: actor.userId, actor, attemptId: randomUUID(), approval: { permissions: ['model:planning'], planningBudgetUSD: 1 } }, events = [], sends = [], checkpoints = [];
    const result = await planner.execute({ input, run, emit: (...entry) => events.push(entry), markSent: entry => sends.push(entry), checkpoint: entry => checkpoints.push(entry), ...changes });
    return { result, run, input, events, sends, checkpoints };
  };
  return { store, config, planner, projectId, prepare, execute, requests };
}

test('AI planning freezes selected public scope, records a separate planning cost, and only returns a proposal', async t => {
  const f = fixture(t), input = await f.prepare();
  assert.equal(f.requests.length, 0); assert(input.estimateUSD > 0); assert.equal(input.type, 'work-planning');
  f.store.mutate(state => { state.accounts[0].name = '后来改名'; state.projects[0].brief.product = '后来改动产品'; });
  const { result, sends, checkpoints, events } = await f.execute({ input });
  assert.equal(result.kind, 'proposal'); assert.equal(result.nodes.length, 3); assert.equal(result.usage.purpose, 'planning');
  assert.equal(sends.length, 1); assert.equal(sends[0].operation, 'controller_planning'); assert.equal(checkpoints[0].type, 'planning_result_ready');
  const start = events.find(row => row[0] === 'planning.model.started')[2], received = events.find(row => row[0] === 'planning.model.received')[2], ready = events.find(row => row[0] === 'planning.proposal.ready')[2];
  assert.equal(sends[0].id, sends[0].callId); assert.equal(start.callId, sends[0].id); assert.equal(received.callId, start.callId); assert.equal(ready.callId, start.callId);
  assert.equal(result.usage.callId, start.callId); assert.equal(ready.durationMs, received.durationMs);
  assert(Number.isFinite(received.durationMs) && received.durationMs >= 0); assert.equal(received.durationBasis, 'dispatch-to-validated-response');
  const serialized = JSON.stringify(f.requests[0].payload);
  assert(serialized.includes('校园 A')); assert(!serialized.includes('后来改名')); assert(!serialized.includes('后来改动产品'));
  assert(!serialized.includes('PRIVATE_OTHER_CHAT')); assert(!serialized.includes('PRIVATE_IDENTITY')); assert(!serialized.includes('dy-not-selected'));
  assert(!JSON.stringify(input).includes(secret)); assert(!JSON.stringify(events).includes(secret));
  assert.equal(f.store.work.all('task').length, 0); assert.equal(f.store.work.all('plan').length, 0); assert.equal(f.store.work.all('run').length, 0);
  const usage = f.store.get().projects[0].usage.at(-1); assert.equal(usage.stage, 'controller_planning'); assert.equal(usage.status, 'completed'); assert(usage.amountUsd > 0);
  assert.equal(usage.callId, start.callId); assert.equal(usage.id, received.usageId);
});

test('a clarification question creates no execution tasks and can have an empty selected-account scope', async t => {
  const f = fixture(t, { output: () => ({ kind: 'question', goal: '准备内容', nodes: [], question: '这轮小红书内容要使用哪个账号？' }) });
  const input = await f.prepare({ accountIds: [] }), { result } = await f.execute({ input });
  assert.equal(result.kind, 'question'); assert.equal(result.nodes.length, 0); assert.equal(f.requests[0].payload.allowedAccounts.length, 0);
  assert.equal(f.store.work.all('task').length, 0);
});

const malformed = [
  ['unknown role', value => { value.nodes[0].role = 'publisher'; }],
  ['unselected account', value => { value.nodes[0].accountId = 'dy-not-selected'; }],
  ['wrong platform', value => { value.nodes[0].accountId = 'dy-b'; }],
  ['unknown source account', value => { value.nodes[1].connectionAccountId = 'guessed-reader'; }],
  ['research cannot inherit private creation identity', value => { value.nodes[1].accountId = 'dy-b'; }],
  ['duplicate node ids', value => { value.nodes[2].id = 'copy'; }],
  ['missing dependency id', value => { value.nodes[2].dependsOn = ['does-not-exist']; }],
  ['cyclic graph', value => { value.nodes[1].dependsOn = ['script']; }],
  ['injected paid budget', value => { value.nodes[0].budgetUSD = 100; }],
  ['injected URL and tools', value => { value.nodes[0].url = 'https://not-permitted.example/upload'; value.nodes[0].tools = ['publish']; }],
  ['injected approval', value => { value.approved = true; }],
  ['mixed question and executable nodes', value => { value.kind = 'question'; value.question = '是否继续？'; }],
];
for (const [name, mutate] of malformed) test(`planning rejects malicious or invalid model output: ${name}`, async t => {
  const f = fixture(t, { output: () => { const value = proposal(); mutate(value); return value; } });
  await assert.rejects(f.execute()); assert.equal(f.requests.length, 1);
  assert.equal(f.store.work.all('task').length, 0); assert.equal(f.store.work.all('plan').length, 0);
  const usage = f.store.get().projects[0].usage.at(-1); assert.equal(usage.status, 'failed'); assert(usage.amountUsd > 0, 'a rejected model answer still retains its actual usage');
});

test('planning requires separate permission and independent budget before any model request', async t => {
  const f = fixture(t), input = await f.prepare(), run = { id: randomUUID(), projectId: f.projectId, ownerId: actor.userId, actor, approval: { permissions: ['model:copy'], budgetUSD: 100 } };
  await assert.rejects(f.execute({ input, run }), /明确确认/);
  run.approval = { permissions: ['model:planning'], planningBudgetUSD: 0 };
  await assert.rejects(f.execute({ input, run }), /规划上限/);
  assert.equal(f.requests.length, 0);
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  run.approval.planningBudgetUSD = 1;
  await assert.rejects(f.execute({ input, run }), /剩余预算/); assert.equal(f.requests.length, 0);
});

test('uncertain network completion preserves reserved planning cost, blocks same-run replay and never auto retries', async t => {
  const f = fixture(t, { fetcher: async () => { throw Error('simulated socket reset'); } }), input = await f.prepare(), run = { id: randomUUID(), projectId: f.projectId, ownerId: actor.userId, actor, approval: { permissions: ['model:planning'], planningBudgetUSD: 1 } };
  const events = [], sends = [];
  await assert.rejects(f.execute({ input, run, emit: (...row) => events.push(row), markSent: row => sends.push(row) }));
  const usage = f.store.get().projects[0].usage.at(-1); assert.equal(usage.status, 'uncertain'); assert.equal(usage.amountUsd, input.estimateUSD); assert.equal(usage.estimated, true);
  const failed = events.find(row => row[0] === 'planning.model.failed')[2];
  assert.equal(failed.callId, sends[0].id); assert.equal(failed.callId, usage.callId); assert.equal(failed.status, 'unknown'); assert.equal(failed.automaticRetry, false);
  assert(Number.isFinite(failed.durationMs) && failed.durationMs >= 0); assert(!JSON.stringify(events).includes('simulated socket reset'));
  assert(!events.some(row => row[0] === 'planning.model.received' || row[0] === 'planning.proposal.ready'));
  await assert.rejects(f.execute({ input, run }), /不能重复派发/); assert.equal(f.requests.length, 1);
});

test('a completed answer without usage preserves the reservation and labels unknown billing', async t => {
  const f = fixture(t, { noUsage: true }), input = await f.prepare(), { result } = await f.execute({ input });
  assert.equal(result.usage.unknown, true); assert.equal(result.usage.estimated, true); assert.equal(result.usage.amountUSD, input.estimateUSD);
  const usage = f.store.get().projects[0].usage.at(-1); assert.equal(usage.status, 'completed'); assert.equal(usage.amountUsd, input.estimateUSD);
});

test('failed dispatch persistence prevents sending and releases only the unsent reservation', async t => {
  const f = fixture(t), events = [];
  await assert.rejects(f.execute({ markSent: () => { throw Error('synthetic persistence unavailable'); }, emit: (...row) => events.push(row) }), /persistence/);
  assert.equal(f.requests.length, 0); const usage = f.store.get().projects[0].usage.at(-1); assert.equal(usage.amountUsd, 0); assert.equal(usage.status, 'failed');
  assert(!events.some(row => row[0].startsWith('planning.model.')));
});

test('invalid planning response has a linked failed call, not completed activity, and keeps known usage', async t => {
  const events = [], sends = [], f = fixture(t, { output: () => { const value = proposal(); value.nodes[0].role = 'publisher'; return value; } });
  await assert.rejects(f.execute({ emit: (...row) => events.push(row), markSent: row => sends.push(row) }));
  const failed = events.find(row => row[0] === 'planning.model.failed')[2];
  assert.equal(failed.callId, sends[0].id); assert.equal(failed.status, 'failed'); assert(Number.isFinite(failed.durationMs));
  assert.equal(f.store.get().projects[0].usage.at(-1).callId, failed.callId);
  assert(!events.some(row => row[0] === 'planning.model.received' || row[0] === 'planning.proposal.ready'));
  assert.equal(f.requests.length, 1); assert.equal(f.store.work.all('run').length, 0);
});

test('revoked ownership and changed credentials fail before generation', async t => {
  const f = fixture(t), input = await f.prepare(); f.config.apiKey = 'rotated-key';
  await assert.rejects(f.execute({ input }), /凭据已经变化/); assert.equal(f.requests.length, 0);
  f.config.authorizeWorkActor = () => false;
  await assert.rejects(f.execute({ input }), /撤销/); assert.equal(f.requests.length, 0);
});

test('targeted revision includes only the selected task and bounded plan summary, never private chats', async t => {
  const original = proposal(), target = original.nodes[0];
  const f = fixture(t, { output: () => ({ kind: 'proposal', goal: original.goal, nodes: [{ ...target, requirement: '把开头改为课堂提问，仍只创作文案。', dependsOn: ['research'] }], question: '' }) });
  const context = { existingPlan: { id: 'local-plan', version: 2, nodes: original.nodes.map(node => ({ ...node, privateChat: 'OTHER_TASK_PRIVATE_CHAT' })), chats: 'ALL_PRIVATE_CHATS' }, currentTask: { nodeId: target.id, messages: 'CURRENT_PRIVATE_CHAT_NOT_REQUESTED' }, message: '只修改这篇的开头。' };
  const input = await f.prepare({ accountIds: ['xhs-a'], context }), { result } = await f.execute({ input });
  assert.equal(input.mode, 'task-revision'); assert.equal(result.nodes.length, 1); assert.equal(result.nodes[0].id, target.id);
  const encoded = JSON.stringify(f.requests[0].payload); assert(!encoded.includes('PRIVATE_CHAT')); assert(encoded.includes('只修改这篇的开头'));
  assert.equal(f.requests[0].payload.context.currentTask.id, target.id); assert.equal(f.requests[0].payload.allowedAccounts.length, 1);
});

test('targeted revision cannot change another task, target identity or introduce a merged-plan cycle', async t => {
  for (const bad of ['other-task', 'other-account', 'cycle']) {
    const value = proposal(), context = { existingPlan: { nodes: value.nodes }, currentTask: { nodeId: bad === 'cycle' ? 'research' : 'copy' }, message: '修订目标任务' };
    const f = fixture(t, { output: () => ({ kind: 'proposal', goal: value.goal, question: '', nodes: [bad === 'other-task' ? value.nodes[2] : bad === 'other-account' ? { ...value.nodes[0], accountId: 'dy-b' } : { ...value.nodes[1], dependsOn: ['script'] }] }) });
    const input = await f.prepare({ context }); await assert.rejects(f.execute({ input })); assert.equal(f.requests.length, 1); assert.equal(f.store.work.all('task').length, 0);
  }
});

test('saved planning response recovers without resending or approving its proposed nodes', async t => {
  const f = fixture(t), { result, checkpoints } = await f.execute();
  assert.deepEqual(f.planner.recover({ run: { checkpoint: checkpoints[0] } }), result);
  assert.equal(f.planner.recover({ run: { checkpoint: { type: 'other' } } }), null);
  assert.equal(f.requests.length, 1); assert.equal(f.store.work.all('task').length, 0);
});
