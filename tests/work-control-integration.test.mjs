import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';

// All provider and MCP requests are injected. Only the test's own loopback HTTP
// listener is contacted; no real key, account, model, or social service is used.
const modelSecret = 'INTEGRATION_MODEL_KEY_MUST_REMAIN_PRIVATE';
const mcpSecret = 'INTEGRATION_MCP_TOKEN_MUST_REMAIN_PRIVATE';
const ownerId = 'integration-owner';
const tools = [
  { name: 'douyin_search', inputSchema: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'integer' } }, required: ['keyword', 'limit'] } },
  { name: 'douyin_video', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
];
const nodes = () => [
  { id: 'campus-copy', title: '校园号 AI 教育图文', role: 'xiaohongshu-copy', accountId: 'campus-a', requirement: 'AI 教育', dependsOn: [], model: 'glm-4.7-flash', budgetUSD: 0 },
  { id: 'douyin-research', title: '抖音 AI 教育同话题研究', role: 'douyin-research', accountId: '', connectionAccountId: 'brand-b', requirement: 'AI 教育', dependsOn: [], model: 'glm-4.7-flash', budgetUSD: 0 },
  { id: 'brand-script', title: '品牌号课堂视频脚本', role: 'douyin-script', accountId: 'brand-b', requirement: '根据已交付研究写 AI 教育课堂脚本', dependsOn: ['douyin-research'], model: 'glm-4.7-flash', budgetUSD: 0 },
];
const copy = platform => ({ title: platform === 'xiaohongshu' ? 'AI 教育课堂观察' : '把 AI 课堂问题拍成短视频', body: '先提出一个真实的课堂问题，再展示教师如何核对 AI 的建议。文案仅供审阅，尚未发布。', prompt: '课堂场景构思，不代表已经生成媒体。', scenes: ['提出课堂问题', '核对已有依据', '邀请说明不同看法'] });
const research = payload => {
  const reference = payload.references[0];
  return { analyses: [{ id: 'a1', title: '课堂问题作为开场', observation: '样本正文围绕 AI 教育中的课堂问题展开。', hypothesis: '具体问题可能帮助读者理解场景，仍待检验。', application: '在脚本开场写出一个可讨论的问题。', tags: ['AI 教育', '课堂观察'], evidence: [{ referenceId: reference.id, quote: 'AI 教育课堂问题' }], limitations: '只有本次关键词样本，不能推断全站表现或因果。', growthAdvice: [{ focus: 'opening', action: '先呈现具体课堂问题。', reason: '选中的样本有对应的正文片段。', validation: '保留版本并比较同口径反馈。', referenceIds: [reference.id] }] }] };
};
function assertPublic(value) {
  const encoded = JSON.stringify(value);
  assert(!encoded.includes(modelSecret), 'model credential leaked through API');
  assert(!encoded.includes(mcpSecret), 'MCP credential leaked through API');
  assert.doesNotMatch(encoded, /"(?:credentialFingerprint|connectionFingerprint|payload|apiKey|authorization|rawRequest|rawResponse)"\s*:/i, 'internal request packet leaked through API');
}
async function until(predicate, describe = () => 'condition not reached') {
  const expires = Date.now() + 8000;
  while (Date.now() < expires) { const value = await predicate(); if (value) return value; await delay(5); }
  assert.fail(await describe());
}
async function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 47), scope: 'work-http-integration' });
  store.mutate(state => {
    state.accounts = [
      { id: 'campus-a', platform: 'xiaohongshu', name: '校园号 A', creationProfile: { revision: 1, identityMarkdown: '原始校园身份', identityFileName: '', presets: [], defaultPresetId: '' } },
      { id: 'brand-b', platform: 'douyin', name: '品牌号 B', mcpAccountId: 'reader-b' },
    ];
    state.projects[0].brief.budgetUsd = 100; state.contentRules = [];
  });
  const projectId = store.get().projects[0].id, initialAssetCount = store.get().projects[0].assets.length;
  const modelCalls = [], mcpCalls = [], chronology = [], released = [];
  let allow = true;
  const gate = options.holdCopy ? new Promise(resolve => released.push(resolve)) : Promise.resolve();
  const connection = { version: 2, activeAccountId: 'other-reader', accounts: [
    { id: 'other-reader', name: '非本轮账号', mode: 'external', endpoint: 'http://127.0.0.1:19060/mcp' },
    { id: 'reader-b', name: '本轮研究账号', mode: 'external', endpoint: 'http://127.0.0.1:19061/mcp', readEndpoint: 'http://127.0.0.1:19062/mcp', readApiKey: mcpSecret },
  ] };
  const config = {
    workOwnerId: ownerId, authorizeWorkActor: actor => allow && actor.userId === ownerId,
    profileMode: true, modelStore: createModelStore(),
    glmVault: { status: () => ({ configured: true }), getKey: async () => modelSecret },
    mcpVaults: { douyin: { status: () => ({ configured: true }), getKey: async () => JSON.stringify(connection) } },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'unexpected external URL; test will never forward it');
      assert.equal(init.headers.Authorization, `Bearer ${modelSecret}`);
      const request = JSON.parse(init.body), payload = JSON.parse(request.messages.find(row => row.role === 'user').content);
      const kind = payload.references ? 'research' : payload.task.channel === 'douyin' ? 'script' : 'copy';
      modelCalls.push({ kind, payload, model: request.model }); chronology.push(`model:${kind}:sent`);
      if (options.networkFailure) throw Error('synthetic interrupted connection');
      if (kind === 'copy') await gate;
      const value = kind === 'research' ? research(payload) : copy(payload.task.channel);
      chronology.push(`model:${kind}:returned`);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 120, completion_tokens: 100 } });
    },
    mcpFetcher: async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:19062/mcp', 'must use the approved non-active reader connection');
      assert.equal(init.headers.Authorization, `Bearer ${mcpSecret}`);
      const request = JSON.parse(init.body); mcpCalls.push(request); chronology.push(`mcp:${request.method === 'tools/call' ? request.params.name : request.method}`);
      if (request.method === 'notifications/initialized') return new Response(null, { status: 204 });
      const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18' }
        : request.method === 'tools/list' ? { tools }
          : request.params.name === 'douyin_search' ? { structuredContent: { items: [{ aweme_id: '12345678901', url: 'https://www.douyin.com/video/12345678901', likes: 123 }] } }
            : request.params.name === 'douyin_video' ? { structuredContent: { aweme_id: '12345678901', url: 'https://www.douyin.com/video/12345678901', description: 'AI 教育课堂问题：教师先核对建议，再邀请学生提出不同看法。', published_at: new Date().toISOString(), likes: 123, comments: 20, collects: 15, shares: 5 } }
              : assert.fail('unexpected MCP operation; no publish/login tool is permitted by this fixture');
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    },
  };
  const app = createApp(store, config), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { released.forEach(resolve => resolve()); await app.locals.workControl?.close(); await app.locals.integrations.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'X-Studio-Client': 'studio-v1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); assertPublic(data); return { status: response.status, data };
  };
  const create = async (selected = nodes()) => {
    const result = await request(`/api/projects/${projectId}/work-plans`, { goal: '校园小红书图文，同时研究抖音，品牌脚本依赖研究成果', nodes: selected, idempotencyKey: randomUUID() });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.plan;
  };
  const approve = async (plan, key = randomUUID()) => { const result = await request(`/api/work-plans/${plan.id}/approvals`, { version: plan.version, budgetUSD: plan.nodes.reduce((sum, node) => sum + node.budgetUSD, 0), idempotencyKey: key }); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  const run = id => store.work.get('run', id);
  return { store, app, projectId, initialAssetCount, request, create, approve, run, modelCalls, mcpCalls, chronology, releaseCopy: () => released.forEach(resolve => resolve()), revoke: () => { allow = false; } };
}

test('real HTTP approval executes three bounded services, parallel copy and research then version-bound script, and maps legacy assets', { timeout: 15000 }, async t => {
  const f = await fixture(t, { holdCopy: true }), plan = await f.create();
  assert.equal(f.modelCalls.length, 0); assert.equal(f.mcpCalls.length, 0); assert.equal(f.store.work.all('run').length, 0);
  const approvalKey = randomUUID(), approval = await f.approve(plan, approvalKey);
  assert.equal(approval.tasks.length, 3);
  const byNode = Object.fromEntries(approval.runs.map(run => [run.node.id, run.id]));
  await until(() => f.modelCalls.some(call => call.kind === 'script'), () => JSON.stringify(approval.runs.map(item => ({ status: f.run(item.id).status, error: f.run(item.id).error }))));
  assert.equal(f.run(byNode['campus-copy']).status, 'running', 'copy remains active while the independent research and downstream script make progress');
  assert.equal(f.run(byNode['douyin-research']).status, 'succeeded');
  const researchRun = f.run(byNode['douyin-research']), researchArtifact = f.store.work.get('artifact', `${researchRun.artifact.id}:${researchRun.artifact.version}`), scriptCall = f.modelCalls.find(call => call.kind === 'script');
  assert.equal(scriptCall.payload.dependencies.length, 1); assert.equal(scriptCall.payload.dependencies[0].artifactId, researchArtifact.artifactId);
  assert.equal(scriptCall.payload.dependencies[0].version, 1); assert.equal(scriptCall.payload.dependencies[0].body, researchArtifact.body);
  assert(f.chronology.indexOf('model:research:returned') < f.chronology.indexOf('model:script:sent'));
  assert.equal(f.modelCalls.find(call => call.kind === 'copy').payload.accountContext.accounts[0].accountId, 'campus-a');
  assert.equal(scriptCall.payload.accountContext.accounts[0].accountId, 'brand-b');
  f.store.mutate(state => { const account = state.accounts.find(item => item.id === 'campus-a'); account.name = '用户后来改名'; account.creationProfile.identityMarkdown = '后来身份'; account.creationProfile.revision++; state.activeCreationAccounts = { xiaohongshu: 'other' }; });
  f.releaseCopy();
  await until(() => approval.runs.every(item => f.run(item.id).status === 'succeeded'), () => JSON.stringify(approval.runs.map(item => f.run(item.id))));
  const replay = await f.approve(plan, approvalKey); assert.equal(replay.runs.length, 3);
  assert.equal(f.modelCalls.length, 3); assert.equal(f.store.work.all('run').length, 3); assert.equal(f.store.work.all('artifact').length, 3);
  assert(f.modelCalls.every(call => call.model === 'glm-4.7-flash'));
  assert.deepEqual(f.mcpCalls.filter(call => call.method === 'tools/call').map(call => call.params.name), ['douyin_search', 'douyin_video']);
  const project = f.store.get().projects.find(item => item.id === f.projectId);
  assert.equal(project.assets.length, f.initialAssetCount + 2);
  const generated = project.assets.filter(asset => asset.workOrigin);
  const copyAsset = generated.find(asset => asset.channel === 'xiaohongshu'), scriptAsset = generated.find(asset => asset.channel === 'douyin');
  assert.equal(copyAsset.contentBrief.accountId, 'campus-a'); assert.equal(scriptAsset.contentBrief.accountId, 'brand-b');
  assert.equal(copyAsset.creationTrace.accounts[0].identityMarkdown, '原始校园身份'); assert.equal(copyAsset.creationTrace.accounts[0].profileRevision, 1);
  assert.equal(copyAsset.mediaData, ''); assert.equal(scriptAsset.mediaData, ''); assert.equal(copyAsset.status, 'queued');
  assert.equal(project.usage.filter(usage => usage.runId).length, 3); assert(project.usage.filter(usage => usage.runId).every(usage => usage.status === 'completed' && usage.amountUsd === 0));
  const notifications = (await f.request('/api/notifications')).data.items;
  assert.equal(notifications.length, 3);
  for (const item of approval.runs) {
    const detail = await f.request(`/api/task-runs/${item.id}`); assert.equal(detail.status, 200); assert.equal(detail.data.run.status, 'succeeded'); assert.equal(detail.data.artifacts.length, 1);
    const task = await f.request(`/api/tasks/${item.taskId}`); assert.equal(task.status, 200);
    const events = (await f.request(`/api/task-runs/${item.id}/events?after=0`)).data.items;
    assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
    assert(events.some(event => event.type === 'invocation.sent')); assert(events.some(event => event.type === 'artifact.saved'));
    const invocations = f.run(item.id).attempts.at(-1).invocations;
    for (const call of invocations) {
      assert.equal(call.id, call.callId, 'persistent invocation and activity share one identifier');
      const paired = events.filter(event => event.detail.callId === call.id);
      assert(paired.some(event => event.type === 'invocation.sent'));
      assert(paired.some(event => ['model.received', 'tool.received'].includes(event.type) && Number.isFinite(event.detail.durationMs)));
      assert(paired.every(event => event.runId === item.id && event.taskId === item.taskId && event.attemptId === f.run(item.id).attemptId));
    }
    const notice = notifications.find(notification => notification.target.runId === item.id);
    const artifact = await f.request(`/api/artifacts/${notice.target.artifactId}/versions/${notice.target.artifactVersion}`);
    assert.equal(artifact.status, 200); assert.equal(artifact.data.artifact.runId, item.id); assert.equal(artifact.data.artifact.accountId, item.node.accountId);
  }
});

test('approval, run, task, event and pause-command HTTP responses expose only public task summaries', { timeout: 15000 }, async t => {
  const f = await fixture(t, { holdCopy: true }), plan = await f.create([nodes()[0]]), approval = await f.approve(plan);
  const runId = approval.runs[0].id;
  await until(() => f.modelCalls.length === 1);
  const detail = (await f.request(`/api/task-runs/${runId}`)).data;
  assert.equal(detail.run.input.modelRoute.model, 'glm-4.7-flash'); assert.equal(detail.run.input.accountId, 'campus-a');
  assert.equal(detail.run.input.payload, undefined); assert.equal(detail.run.input.connections, undefined); assert.equal(detail.run.checkpoint, undefined); assert.equal(detail.run.actor, undefined);
  const paused = await f.request(`/api/task-runs/${runId}/commands`, { command: 'pause', expectedRevision: detail.run.revision, idempotencyKey: randomUUID() });
  assert.equal(paused.status, 200, JSON.stringify(paused.data)); assert.equal(paused.data.run.requestedAction, 'pause');
  await f.request(`/api/tasks/${approval.tasks[0].id}`); await f.request(`/api/projects/${f.projectId}/tasks`); await f.request(`/api/work-plans/${plan.id}`); await f.request(`/api/task-runs/${runId}/events?after=0`);
  f.releaseCopy(); await until(() => f.run(runId).status === 'paused');
  const final = (await f.request(`/api/task-runs/${runId}`)).data;
  assert.equal(final.artifacts.length, 1); assert.equal(final.artifacts[0].candidate, true); assert.equal(f.modelCalls.length, 1);
});

test('a real executor network uncertainty persists through HTTP and does not auto repeat', { timeout: 15000 }, async t => {
  const f = await fixture(t, { networkFailure: true }), plan = await f.create([nodes()[0]]), approval = await f.approve(plan), runId = approval.runs[0].id;
  await until(() => f.run(runId).status === 'needs_reconciliation');
  await f.app.locals.workControl.tick(); await f.app.locals.workControl.tick();
  assert.equal(f.modelCalls.length, 1);
  const response = await f.request(`/api/task-runs/${runId}`); assert.equal(response.status, 200); assert.equal(response.data.artifacts.length, 0);
  assert.equal(response.data.run.status, 'needs_reconciliation');
  const retry = await f.request(`/api/task-runs/${runId}/commands`, { command: 'retry', expectedRevision: response.data.run.revision, idempotencyKey: randomUUID() });
  assert.equal(retry.status, 409); assert.equal(f.modelCalls.length, 1);
  assert.equal(f.store.get().projects[0].usage.at(-1).status, 'uncertain');
});
