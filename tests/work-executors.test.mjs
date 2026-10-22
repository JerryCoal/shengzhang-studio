import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { createActiveJobs } from '../server/active-jobs.mjs';
import { createWorkExecutors } from '../server/work-executors.mjs';
import { createModelStore } from '../server/models.mjs';
import { mountMCPPlatforms } from '../server/mcp-platforms.mjs';

const actor = { userId: 'worker-owner', role: 'admin' };
const value = { title: '一起看未来课堂', body: '把 AI 作为教学辅助，先明确学习目标，再由教师核对结果。', prompt: '真实课堂的观察记录；图片仅为构思。', scenes: ['提出问题', '展示可验证步骤', '邀请讨论'] };
const response = (output = value) => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 80 } });
function fixture(t, options = {}) {
  const store = createStore(':memory:'), jobs = createActiveJobs(), config = { apiKey: 'mock-key-not-a-real-credential', authorizeWorkActor: candidate => candidate.userId === actor.userId, modelStore: createModelStore(), workFetcher: async () => response(), ...options.config };
  store.mutate(state => { state.accounts.push({ id: 'xhs-a', name: '校园 A', platform: 'xiaohongshu' }, { id: 'douyin-b', name: '品牌 B', platform: 'douyin', mcpAccountId: 'reader-b' }); state.projects[0].brief.budgetUsd = 100; state.contentRules = []; });
  t.after(() => store.close());
  const executor = createWorkExecutors({ store, activeJobs: jobs, config, integrations: options.integrations });
  const node = { id: 'copy-a', title: '未来课堂图文', role: 'xiaohongshu-copy', accountId: 'xhs-a', requirement: 'AI 教育', budgetUSD: 1, ...(options.node || {}) };
  async function packet() { const state = store.get(), project = state.projects[0]; const input = { ...executor.prepare({ state, project, node }), ...await executor.prepareConnection({ actor, node }) }; return { input, run: { id: 'run-a', taskId: 'task-a', projectId: project.id, ownerId: actor.userId, actor, attemptId: 'attempt-a', input, approval: { budgetUSD: node.budgetUSD, permissions: input.permissions } } }; }
  return { store, jobs, config, executor, node, packet };
}
async function execute(f, changes = {}) { const packet = await f.packet(), events = [], sent = [], checkpoints = []; const result = await f.executor.execute({ ...packet, emit: (...event) => events.push(event), markSent: entry => sent.push(entry), checkpoint: entry => checkpoints.push(entry), ...changes }); return { result, events, sent, checkpoints, ...packet }; }

test('worker freezes account/Skill context and produces copy without a page or publishing', async t => {
  const f = fixture(t), packet = await f.packet();
  const frozen = JSON.stringify(packet.input);
  f.store.mutate(state => { state.accounts.find(account => account.id === 'xhs-a').name = '已改名'; state.activeCreationAccounts = { xiaohongshu: 'other' }; });
  const sent = [], checkpoints = [], events = [];
  const result = await f.executor.execute({ ...packet, markSent: row => sent.push(row), checkpoint: row => checkpoints.push(row), emit: (...row) => events.push(row) });
  assert.equal(JSON.stringify(packet.input), frozen); assert.equal(packet.input.accountName, '校园 A');
  assert.equal(result.kind, 'copy'); assert.equal(result.title, value.title); assert.deepEqual(result.legacy, {});
  assert.equal(sent.length, 1); assert.equal(checkpoints.at(-1).type, 'result_ready');
  const start = events.find(row => row[0] === 'model.started')[2], end = events.find(row => row[0] === 'model.completed')[2];
  assert.equal(sent[0].id, sent[0].callId); assert.equal(start.callId, sent[0].id); assert.equal(end.callId, start.callId);
  assert.equal(result.usage.callId, start.callId); assert.equal(result.usage.usageId, sent[0].usageId);
  assert.equal(f.store.get().projects[0].usage.at(-1).callId, start.callId);
  assert(Number.isFinite(end.durationMs) && end.durationMs >= 0); assert.equal(end.durationBasis, 'dispatch-to-validated-response');
  assert.equal(events.find(row => row[0] === 'model.received')[2].durationMs, end.durationMs);
  assert(events.some(row => row[0] === 'skill.loaded')); assert(events.some(row => row[0] === 'content.checked'));
  assert.equal(f.jobs.size, 0); assert.equal(f.store.get().projects[0].usage.at(-1).status, 'completed');
});

test('a persistent dispatch boundary must succeed before the provider is called', async t => {
  let calls = 0; const f = fixture(t, { config: { workFetcher: async () => { calls++; return response(); } } });
  const packet = await f.packet(), events = [];
  await assert.rejects(f.executor.execute({ ...packet, emit: (...row) => events.push(row), checkpoint: () => {}, markSent: () => { throw Error('durable boundary unavailable'); } }));
  assert.equal(calls, 0); assert.equal(f.store.get().projects[0].usage.at(-1).amountUsd, 0);
  assert.equal(events.filter(row => row[0].startsWith('model.')).length, 0, 'a rejected local boundary is not a model call');
});

test('unknown network completion preserves reservation and never auto retries', async t => {
  let calls = 0; const f = fixture(t, { config: { workFetcher: async () => { calls++; throw Error('socket closed'); } } });
  const events = [], sent = [];
  await assert.rejects(execute(f, { emit: (...row) => events.push(row), markSent: row => sent.push(row) }));
  assert.equal(calls, 1); const usage = f.store.get().projects[0].usage.at(-1);
  assert.equal(usage.status, 'uncertain'); assert(usage.amountUsd > 0); assert.equal(f.jobs.size, 0);
  const failed = events.find(row => row[0] === 'model.failed')[2];
  assert.equal(failed.callId, sent[0].id); assert.equal(failed.status, 'unknown'); assert.equal(failed.automaticRetry, false);
  assert(Number.isFinite(failed.durationMs) && failed.durationMs >= 0); assert(!events.some(row => row[0] === 'model.completed'));
});

test('revoked member or changed credential cannot dispatch frozen approval', async t => {
  let calls = 0; const f = fixture(t, { config: { workFetcher: async () => { calls++; return response(); } } }), packet = await f.packet();
  f.config.apiKey = 'different-secret';
  await assert.rejects(f.executor.execute({ ...packet, markSent: () => {}, checkpoint: () => {} }), /密钥或账户已更改/);
  f.config.authorizeWorkActor = () => false;
  await assert.rejects(f.executor.execute({ ...packet, markSent: () => {}, checkpoint: () => {} }), /撤销/);
  assert.equal(calls, 0);
});

test('missing plan permissions and exceeded budget do not invoke providers', async t => {
  let calls = 0; const f = fixture(t, { config: { workFetcher: async () => { calls++; return response(); } } }), packet = await f.packet();
  await assert.rejects(f.executor.execute({ ...packet, run: { ...packet.run, approval: { budgetUSD: 1, permissions: [] } }, markSent: () => {}, checkpoint: () => {} }), /权限/);
  await assert.rejects(f.executor.execute({ ...packet, run: { ...packet.run, approval: { ...packet.run.approval, budgetUSD: 0 } }, markSent: () => {}, checkpoint: () => {} }), /费用上限/);
  assert.equal(calls, 0);
});

test('successful response is durably checkpointed and recoverable without generating again', async t => {
  let calls = 0; const f = fixture(t, { config: { workFetcher: async () => { calls++; return response(); } } });
  const outcome = await execute(f), recovered = f.executor.recover({ run: { checkpoint: outcome.checkpoints.at(-1) } });
  assert.deepEqual(recovered, outcome.result); assert.equal(calls, 1);
  assert.equal(f.executor.recover({ run: { checkpoint: { type: 'research.collected' } } }), null);
});

test('script consumes versioned dependency text while preserving role-specific output', async t => {
  let seen; const f = fixture(t, { node: { role: 'douyin-script', accountId: 'douyin-b', dependsOn: ['research'] }, config: { workFetcher: async (_url, options) => { seen = JSON.parse(JSON.parse(options.body).input); return response(); } } });
  const { result } = await execute(f, { dependencies: [{ artifactId: 'research', version: 2, kind: 'research', title: '观察', body: '可见样本反馈，不是全站规律。' }] });
  assert.equal(result.kind, 'script'); assert.equal(seen.dependencies[0].version, 2); assert.equal(seen.task.channel, 'douyin');
});

test('research saves empty-source report and does not send an AI analysis', async t => {
  let calls = 0, connection;
  const f = fixture(t, { node: { role: 'douyin-research', accountId: '', connectionAccountId: 'douyin-b' }, config: { workFetcher: async () => { calls++; return response(); } }, integrations: { workResearchConnection: async input => { connection = input.accountId; return { connectionAccountId: input.accountId, connectionFingerprint: 'mock-fingerprint' }; }, workResearchSearch: async () => ({ items: [], reports: [{ status: 'failed', message: '没有正文' }] }) } });
  const checkpoints = [];
  await assert.rejects(execute(f, { checkpoint: row => checkpoints.push(row) }), /没有同时满足/);
  assert.equal(connection, 'reader-b'); assert.equal(calls, 0); assert.equal(checkpoints[0].type, 'research.collected');
});

test('MCP same-name calls retain distinct dispatch identities and never pair a later response with an unresolved call', async t => {
  const sent = [], events = [];
  const f = fixture(t, { node: { role: 'douyin-research', accountId: '', connectionAccountId: 'douyin-b' }, integrations: {
    workResearchConnection: async input => ({ connectionAccountId: input.accountId, connectionFingerprint: 'mock' }),
    workResearchSearch: async ({ hooks }) => {
      await hooks.afterRequest('unsolicited');
      await hooks.beforeRequest('connect'); await hooks.afterRequest('connect');
      await hooks.beforeRequest('douyin_search'); // A failed search can be swallowed into the source report.
      await hooks.beforeRequest('douyin_search'); await hooks.afterRequest('douyin_search');
      await hooks.beforeRequest('douyin_video'); // No return before collection ends.
      return { items: [], reports: [{ status: 'failed', message: 'synthetic incomplete response' }] };
    },
  } });
  await assert.rejects(execute(f, { markSent: row => sent.push(row), emit: (...row) => events.push(row) }), /没有同时满足/);
  assert.equal(sent.length, 4); assert.equal(new Set(sent.map(row => row.callId)).size, 4);
  const started = events.filter(row => row[0] === 'tool.started'), received = events.filter(row => row[0] === 'tool.received'), unknown = events.filter(row => row[0] === 'tool.unknown');
  assert.deepEqual(started.map(row => row[2].callId), sent.map(row => row.id));
  assert.deepEqual(received.map(row => row[2].callId), [sent[0].id, sent[2].id]);
  assert.deepEqual(unknown.map(row => row[2].callId), [sent[1].id, sent[3].id]);
  for (const [, , detail] of received) { assert(Number.isFinite(detail.durationMs) && detail.durationMs >= 0); assert.equal(detail.businessSuccess, 'not-yet-validated'); }
  for (const [, , detail] of unknown) { assert.equal(detail.durationMs, undefined); assert(Number.isFinite(detail.elapsedMs)); assert.equal(detail.status, 'unknown'); }
  assert.equal(events.filter(row => row[0].startsWith('model.')).length, 0);
});

test('MCP rejected durable dispatch has no started or received activity and provider failures leak no raw details', async t => {
  const events = [];
  const f = fixture(t, { node: { role: 'douyin-research', accountId: '', connectionAccountId: 'douyin-b' }, integrations: {
    workResearchConnection: async input => ({ connectionAccountId: input.accountId, connectionFingerprint: 'mock' }),
    workResearchSearch: async ({ hooks }) => { await hooks.beforeRequest('connect'); assert.fail('must stop at rejected durable boundary'); },
  } });
  await assert.rejects(execute(f, { markSent: () => { throw Error('private boundary detail'); }, emit: (...row) => events.push(row) }), /private boundary/);
  assert(!events.some(row => row[0].startsWith('tool.')));
  const g = fixture(t, { config: { workFetcher: async () => { throw Error('SECRET_RAW_PROVIDER_BODY_DO_NOT_LOG'); } } });
  await assert.rejects(execute(g, { emit: (...row) => events.push(row) }));
  assert(!JSON.stringify(events).includes('SECRET_RAW_PROVIDER_BODY_DO_NOT_LOG'));
  assert(events.some(row => row[0] === 'model.failed' && row[2].status === 'unknown'));
});

test('real research validation rejects invented evidence while retaining collection', async t => {
  let calls = 0; const checkpoints = [];
  const f = fixture(t, { node: { role: 'douyin-research', accountId: '', connectionAccountId: 'douyin-b' }, config: { workFetcher: async () => { calls++; return response({ analyses: [{ id: 'a1', title: 'AI 教育', observation: '观察', hypothesis: '可能', application: '测试', tags: ['AI 教育'], evidence: [{ referenceId: 'made-up-id', quote: '虚构原文' }], limitations: '仅本次样本', growthAdvice: [{ focus: 'title', action: '测试', reason: '观察', validation: '核对', referenceIds: ['made-up-id'] }] }] }); } }, integrations: { workResearchConnection: async input => ({ connectionAccountId: input.accountId, connectionFingerprint: 'mock' }), workResearchSearch: async () => ({ items: [{ kind: 'douyin', title: 'AI 教育课堂观察', text: 'AI 教育需要教师核对结果', url: 'https://www.douyin.com/video/1234567890', publishedAt: new Date().toISOString(), dateBasis: 'platform-timestamp', metrics: { likes: 100, comments: 12 }, noteType: 'video' }], reports: [] }) } });
  await assert.rejects(execute(f, { checkpoint: row => checkpoints.push(row) }));
  assert.equal(calls, 1); assert.equal(checkpoints[0].type, 'research.collected');
  assert.equal(f.store.get().projects[0].usage.at(-1).status, 'uncertain');
});

test('pre-dispatch abort and occupied research lock cannot call external services', async t => {
  const f = fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(execute(f, { signal: controller.signal }), /停止/);
  const packet = await f.packet(); const token = f.jobs.acquire(packet.input.projectId, 'work-task:task-a');
  await assert.rejects(f.executor.execute({ ...packet, checkpoint: () => {}, markSent: () => {} }), /执行任务/);
  f.jobs.release(packet.input.projectId, 'work-task:task-a', token);
});

test('Qwen transport uses approved region even after current settings change', async t => {
  const urls = []; const f = fixture(t, { node: { model: 'qwen-plus' }, config: { qwenVault: { status: () => ({ configured: true }), getKey: async () => 'mock-qwen-credential' }, workFetcher: async (url) => { urls.push(String(url)); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }); } } });
  const packet = await f.packet();
  f.store.mutate(state => { state.qwenConnection = { region: 'ap-southeast-1', workspaceId: '' }; });
  const result = await f.executor.execute({ ...packet, markSent: () => {}, checkpoint: () => {} });
  assert.equal(result.kind, 'copy'); assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/dashscope\.aliyuncs\.com\//); assert.doesNotMatch(urls[0], /intl/);
});

test('internal MCP adapter binds approved connection, rejects changed service and revoked actor', async t => {
  const f = fixture(t), urls = [], invocations = [];
  const saved = { version: 2, activeAccountId: 'other', accounts: [{ id: 'other', name: '其他账号', mode: 'external', endpoint: 'http://127.0.0.1:18060/mcp' }, { id: 'reader-b', name: '研究读取', mode: 'external', endpoint: 'http://127.0.0.1:18061/mcp', readEndpoint: 'http://127.0.0.1:18062/mcp' }] };
  const tools = [{ name: 'douyin_search', inputSchema: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'integer' } }, required: ['keyword', 'limit'] } }, { name: 'douyin_video', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }];
  const config = { authorizeWorkActor: () => true, mcpVaults: { douyin: { status: () => ({ configured: true }), getKey: async () => JSON.stringify(saved) } }, mcpFetcher: async (url, init) => { urls.push(url); const request = JSON.parse(init.body); if (request.method === 'notifications/initialized') return new Response(null, { status: 204 }); const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18' } : request.method === 'tools/list' ? { tools } : { structuredContent: { items: [] } }; return Response.json({ jsonrpc: '2.0', id: request.id, result }); } };
  const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method, () => {}]));
  const adapter = mountMCPPlatforms(app, f.store, config, { project: () => f.store.get().projects[0], activeJobs: f.jobs });
  t.after(() => adapter.close());
  const connection = await adapter.workResearchConnection({ actor, accountId: 'reader-b' });
  const projectId = f.store.get().projects[0].id, input = { role: 'douyin-research', projectId, ...connection };
  const request = { run: { projectId, ownerId: actor.userId, actor, input, approval: { permissions: ['mcp:douyin:search'] } }, queries: ['AI 教育'], at: Date.now(), discovery: { timeRange: 'month', sortBy: 'general', noteType: 'all' }, hooks: { beforeRequest: name => invocations.push(name) } };
  const result = await adapter.workResearchSearch(request);
  assert.deepEqual(result.items, []); assert(urls.length > 0); assert(urls.every(url => url === 'http://127.0.0.1:18062/mcp'));
  assert(invocations.includes('connect')); assert(invocations.includes('douyin_search'));
  const previousCount = urls.length;
  saved.accounts[1].readEndpoint = 'http://127.0.0.1:18063/mcp';
  await assert.rejects(adapter.workResearchSearch(request), /已更改/); assert.equal(urls.length, previousCount);
  config.authorizeWorkActor = () => false;
  await assert.rejects(adapter.workResearchSearch(request), /撤销/); assert.equal(urls.length, previousCount);
});

test('explicit task skills bypass inherited custom defaults and validate selected workflow', async t => {
  const { installCreativeSkill } = await import('../server/creative-skills.mjs');
  const f = fixture(t); let copySkill, researchSkill;
  const source = name => '---\nname: ' + name + '\ndescription: 合成派工规则\nversion: 1.0.0\n---\n\n# 内容规则\n围绕真实场景撰写，保留事实与限制。';
  f.store.mutate(state => {
    copySkill = installCreativeSkill(state, { fileName: 'SKILL.md', text: source('selected-copy'), workflowId: 'copy-xiaohongshu', expectedRevision: state.skillsRevision || 0, confirmed: true });
    researchSkill = installCreativeSkill(state, { fileName: 'SKILL.md', text: source('selected-research'), workflowId: 'research-analysis', expectedRevision: state.skillsRevision, confirmed: true });
    state.skillSelections = { ...state.skillSelections, 'copy-xiaohongshu': copySkill.id };
  });
  const prepare = patch => { const state = f.store.get(); return f.executor.prepare({ state, project: state.projects[0], node: { ...f.node, ...patch } }); };
  assert(prepare({}).skills.some(skill => skill.id === copySkill.id));
  const defaults = prepare({ skillMode: 'default', skillIds: [] }); assert(defaults.skills.length > 0); assert(!defaults.skills.some(skill => skill.id === copySkill.id)); assert(!defaults.payload.creativeSkill);
  const selected = prepare({ skillMode: 'selected', skillIds: [copySkill.id] }); assert.equal(selected.skills.filter(skill => skill.id === copySkill.id).length, 1); assert.equal(selected.payload.agentContext.skills[0].version, '1.0.0');
  assert.throws(() => prepare({ skillMode: 'selected', skillIds: [researchSkill.id] }), /不适用/);
  assert.throws(() => prepare({ skillMode: 'selected', skillIds: [] }), /请选择/);
});
