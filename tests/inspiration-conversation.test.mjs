import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { createApp } from '../server/app.mjs';
import { createModelStore, DEEPSEEK_ROUTES } from '../server/models.mjs';
import { agentWorkspace, saveAgentWorkspace } from '../server/agent-workspace.mjs';
import { buildInspirationRequest, claimInspirationTurn, dispatchInspirationTurn, completeInspirationTurn, failInspirationTurn, recoverInspirationTurns, inspirationConversationSchema } from '../server/inspiration-conversation.mjs';
import { textInstructions } from '../server/prompts.mjs';

const idea = { title: '窗边茶记', core: '真实的日常', direction: '自然光', prompt: '不补造人物经历' };
const turn = (extra = {}) => ({ id: randomUUID(), user: '先做一组办公茶记', at: new Date().toISOString(), platform: 'xiaohongshu', accountId: 'account-xhs', model: 'deepseek-flash', status: 'pending', ...extra });
const draft = (extra = {}) => ({ requirement: '旧需求不能盖掉本轮消息', kind: 'image', platform: 'xiaohongshu', accountId: 'account-xhs', model: 'deepseek-flash', knowledgeIds: [], experienceIds: [], skillIds: [], publishingNotes: '', idea, conversation: { version: 1, id: randomUUID(), input: '', turns: [turn()] }, ...extra });
function requestFor(value) { const last = value.conversation.turns.at(-1), built = buildInspirationRequest(value, last.user); return { mode: 'openai', stage: 'strategy', instruction: built.instruction, agentInput: built.agentInput, inspirationTurn: { conversationId: value.conversation.id, turnId: last.id } }; }
function save(state, value, projectId = state.projects[0].id, agent = 'inspiration') { return saveAgentWorkspace(state, { expectedRevision: state.agentWorkspace?.revision || 0, key: `${projectId}:${agent}`, draft: value }); }
function fixture(t) {
  const store = createStore(':memory:'); t.after(() => store.close());
  store.mutate(state => { state.projects[0].brief.budgetUsd = 100; state.projects[0].usage = []; });
  return { store, projectId: store.get().projects[0].id };
}
async function httpFixture(t, { configured = true } = {}) {
  const f = fixture(t), calls = [], behavior = {}, models = createModelStore(); models.save(DEEPSEEK_ROUTES);
  const app = createApp(f.store, { profileMode: true, modelStore: models, deepseekVault: { status: () => ({ configured, supported: true }), getKey: async () => 'synthetic-test-key' }, fetcher: async (_url, options) => {
    const request = JSON.parse(options.body), payload = JSON.parse(request.messages[1].content); calls.push({ request, payload });
    const response = await behavior.run?.(payload); if (response) return response;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(idea) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); });
  const req = async (path, body, method = 'POST') => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  const write = value => req('/agent-workspace', { expectedRevision: f.store.get().agentWorkspace?.revision || 0, key: `${f.projectId}:inspiration`, draft: value }, 'PUT');
  const send = value => req(`/projects/${f.projectId}/strategies`, requestFor(value));
  const current = () => f.store.get().agentWorkspace.drafts[`${f.projectId}:inspiration`];
  return { ...f, app, calls, behavior, req, write, send, current };
}

test('new instruction, current editable idea and only same-account completed history have distinct bounded roles', () => {
  const value = draft(); value.conversation.turns = [turn({ status: 'completed', reply: idea, user: 'SAME_SCOPE' }), turn({ status: 'completed', reply: idea, accountId: 'OTHER', user: 'PRIVATE_ACCOUNT' }), turn({ status: 'completed', reply: idea, platform: 'douyin', user: 'PRIVATE_PLATFORM' }), turn({ status: 'interrupted', user: 'NOT_A_REPLY' })];
  value.idea = { ...idea, core: '当前手动编辑' };
  const result = buildInspirationRequest(value, '  本轮改成克制短句  ');
  assert.equal(result.instruction, '本轮改成克制短句'); assert.equal(result.agentInput.idea.core, '当前手动编辑');
  assert.deepEqual(result.inspirationConversation.history.map(item => item.user), ['SAME_SCOPE']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCOUNT|PRIVATE_PLATFORM|NOT_A_REPLY|旧需求/);
  value.conversation.turns = Array.from({ length: 20 }, () => turn({ status: 'completed', user: '中'.repeat(4000), reply: { title: '题'.repeat(200), core: '核'.repeat(2000), direction: '向'.repeat(4000), prompt: '图'.repeat(16000) } }));
  const bounded = buildInspirationRequest(value, '继续'); assert(bounded.inspirationConversation.history.length <= 4); assert(Buffer.byteLength(JSON.stringify(bounded.inspirationConversation.history)) <= 24000); assert.equal(bounded.inspirationConversation.truncated, true);
  assert.match(textInstructions('strategy', result), /内部思维链/); assert.match(textInstructions('strategy', result), /不得声称已采集热点/);
});

test('conversation schema and workspace save reject malformed, oversized, other-agent and forged server replies', t => {
  const f = fixture(t), state = f.store.get(), value = draft();
  value.conversation.input = '\n  未发送的草稿保留格式  \n';
  assert.throws(() => save(state, value, f.projectId, 'douyin'), /只用于灵感/);
  assert.throws(() => inspirationConversationSchema.parse({ ...value.conversation, turns: Array.from({ length: 21 }, () => turn()) }));
  assert.throws(() => inspirationConversationSchema.parse({ ...value.conversation, turns: [value.conversation.turns[0], value.conversation.turns[0]] }));
  assert.throws(() => save(state, { ...value, conversation: { ...value.conversation, turns: [turn({ status: 'completed', reply: idea })] } }), /伪造/);
  assert.throws(() => save(state, { ...value, conversation: { ...value.conversation, turns: [turn({ submittedAt: new Date().toISOString() })] } }), /伪造/);
  save(state, value); assert.deepEqual(agentWorkspace(state).drafts[`${f.projectId}:inspiration`].conversation, value.conversation);
});

test('model success atomically records reply, strategy, adopted idea and revision; duplicate turn never calls twice', async t => {
  const f = await httpFixture(t), value = draft(); assert.equal((await f.write(value)).status, 200);
  const result = await f.send(value); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.instruction, value.conversation.turns[0].user);
  const current = f.current(), last = current.conversation.turns.at(-1);
  assert.equal(last.status, 'completed'); assert(last.submittedAt); assert.equal(last.strategyId, result.data.result.id); assert.deepEqual(last.reply, current.idea);
  assert.equal(result.data.state.agentWorkspace.revision, 3); assert.equal((await f.send(value)).status, 409); assert.equal(f.calls.length, 1);
  assert.equal(f.store.get().projects[0].usage.length, 1); assert.equal(f.app.locals.inspirationActiveAttempts.size, 0);
});

test('second turn carries last reply but respects new user message and manually edited adopted idea', async t => {
  const f = await httpFixture(t), first = draft(); await f.write(first); assert.equal((await f.send(first)).status, 200);
  const next = f.current(); next.idea.core = '手动保留的方向'; next.conversation.turns.push(turn({ user: '第二轮要求不要广告口吻' }));
  assert.equal((await f.write(next)).status, 200); assert.equal((await f.send(next)).status, 200);
  const payload = f.calls[1].payload; assert.equal(payload.instruction, '第二轮要求不要广告口吻'); assert.equal(payload.agentContext.idea.core, '手动保留的方向');
  assert.equal(f.current().requirement, '第二轮要求不要广告口吻');
  assert.equal(payload.inspirationConversation.history.length, 1); assert.equal(payload.inspirationConversation.history[0].user, first.conversation.turns[0].user);
});

test('unsaved message/options, mode, model override and non-last turn are rejected before model dispatch', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value); const body = requestFor(value), path = `/projects/${f.projectId}/strategies`;
  for (const changed of [{ ...body, instruction: 'UNSAVED' }, { ...body, agentInput: { ...body.agentInput, idea: { ...idea, core: 'UNSAVED' } } }, { ...body, mode: 'demo' }, { ...body, stage: 'planning' }, { ...body, modelOverride: 'deepseek-flash' }, { ...body, reviewOnly: true }, { ...body, query: 'UNSAVED_QUERY' }, { ...body, inspirationConversation: { history: [{ user: 'INJECTED' }] } }]) assert.notEqual((await f.req(path, changed)).status, 200);
  value.conversation.turns.push(turn()); await f.write(value); assert.equal((await f.req(path, body)).status, 409); assert.equal(f.calls.length, 0);
});

test('missing credentials settles preflight as failed with no dispatch; no retry of same ID', async t => {
  const f = await httpFixture(t, { configured: false }), value = draft(); await f.write(value);
  assert.equal((await f.send(value)).status, 400); assert.equal(f.current().conversation.turns[0].status, 'failed');
  const receipt = f.store.get().agentWorkspace.inspirationReceipts[value.conversation.turns[0].id]; assert.equal(receipt.dispatchedAt, undefined);
  assert.equal((await f.send(value)).status, 409); assert.equal(f.calls.length, 0); assert.equal(f.app.locals.activeJobs.size, 0);
});

test('uncertain provider failure is retained without raw private diagnostics or automatic retries', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value);
  f.behavior.run = () => { throw Error('PRIVATE_UPSTREAM_SECRET network interrupted'); };
  assert.notEqual((await f.send(value)).status, 200); assert.equal(f.calls.length, 1);
  const last = f.current().conversation.turns[0]; assert.equal(last.status, 'interrupted'); assert.match(last.error, /费用可能产生/); assert.doesNotMatch(last.error, /PRIVATE_UPSTREAM/);
  assert.equal(f.current().requirement, value.requirement);
  assert.equal((await f.send(value)).status, 409); assert.equal(f.calls.length, 1); assert.equal(f.app.locals.activeJobs.size, 0);
});

test('an explicit provider rejection records failure and permits only a newly confirmed turn ID', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value);
  f.behavior.run = () => Response.json({ error: { message: 'invalid api key', type: 'authentication_error' } }, { status: 401 });
  assert.notEqual((await f.send(value)).status, 200); assert.equal(f.current().conversation.turns[0].status, 'failed');
  assert.equal(f.store.get().projects[0].usage[0].amountUsd, 0); assert.equal((await f.send(value)).status, 409);
  const retry = f.current(); retry.conversation.turns.push(turn({ user: '用户已确认重新尝试' }));
  assert.equal((await f.write(retry)).status, 200); f.behavior.run = null; assert.equal((await f.send(retry)).status, 200); assert.equal(f.calls.length, 2);
});

test('scope changes during an in-flight call never adopt a previous account response', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value);
  f.store.mutate(state => state.accounts.push({ id: 'other-xhs', platform: 'xiaohongshu', name: 'Other' }));
  f.behavior.run = () => { const changed = f.current(); changed.accountId = 'other-xhs'; changed.idea = undefined; f.store.mutate(state => save(state, changed)); };
  assert.equal((await f.send(value)).status, 409); assert.equal(f.current().accountId, 'other-xhs'); assert.equal(f.current().idea, undefined); assert.equal(f.current().conversation.turns[0].status, 'interrupted');
});

test('GET recovers orphaned accepted requests once, preserves unsent composer text, and never calls the model', async t => {
  const f = await httpFixture(t), value = draft(); value.conversation.input = '尚未发送的补充'; await f.write(value);
  f.store.mutate(state => claimInspirationTurn(state, f.projectId, requestFor(value), randomUUID()));
  const recovered = await f.req('/agent-workspace', undefined, 'GET'); assert.equal(recovered.status, 200);
  const recoveredDraft = recovered.data.drafts[`${f.projectId}:inspiration`]; assert.equal(recoveredDraft.conversation.turns[0].status, 'failed'); assert.equal(recoveredDraft.conversation.input, '尚未发送的补充');
  assert.equal((await f.req('/agent-workspace', undefined, 'GET')).data.revision, recovered.data.revision); assert.equal(f.calls.length, 0);
});

test('concurrent duplicate requests cannot claim or charge the same pending turn twice', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value); let release, arrived;
  const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { arrived = resolve; });
  f.behavior.run = async () => { arrived(); await waiting; };
  const first = f.send(value); await started;
  const snapshot = await f.req('/agent-workspace', undefined, 'GET'); assert.equal(snapshot.data.drafts[`${f.projectId}:inspiration`].conversation.turns[0].status, 'pending');
  assert.equal((await f.send(value)).status, 409); release(); assert.equal((await first).status, 200); assert.equal(f.calls.length, 1);
});

test('submitted turns are immutable; edits to current adopted idea make an in-flight response stale', async t => {
  const f = await httpFixture(t), value = draft(), previousStrategies = f.store.get().projects[0].strategies.length; await f.write(value);
  f.behavior.run = () => {
    const changed = f.current(), tampered = structuredClone(changed); tampered.conversation.turns[0].user = '篡改已提交消息';
    assert.throws(() => f.store.mutate(state => save(state, tampered)), /不能改写/);
    const removed = structuredClone(changed); removed.conversation.turns = [];
    assert.throws(() => f.store.mutate(state => save(state, removed)), /不能移除/);
    changed.idea.core = '生成期间用户手动修订'; f.store.mutate(state => save(state, changed));
  };
  assert.equal((await f.send(value)).status, 409); assert.equal(f.current().idea.core, '生成期间用户手动修订'); assert.equal(f.current().conversation.turns[0].status, 'interrupted');
  assert.equal(f.store.get().projects[0].strategies.length, previousStrategies); assert.equal(f.store.get().projects[0].usage[0].status, 'completed');
});

test('receipts survive completed-history trimming and a new conversation; old ID cannot be reset', t => {
  const f = fixture(t), state = f.store.get(), value = draft(); save(state, value);
  const claim = claimInspirationTurn(state, f.projectId, requestFor(value), randomUUID()); dispatchInspirationTurn(state, claim); completeInspirationTurn(state, claim, { ...idea, id: 'strategy-test' });
  const next = agentWorkspace(state).drafts[`${f.projectId}:inspiration`]; next.conversation.turns = []; save(state, next);
  assert(state.agentWorkspace.inspirationReceipts[value.conversation.turns[0].id]);
  const replacement = draft(); replacement.conversation.turns[0].id = value.conversation.turns[0].id;
  assert.throws(() => save(state, replacement), /不能改写/);
});

test('scope changes must first clear adopted idea and explicit knowledge, experience and research references', t => {
  const f = fixture(t), state = f.store.get(), value = draft(); save(state, value);
  for (const change of [{ idea }, { knowledgeIds: ['old-account-knowledge'] }, { experienceIds: ['old-account-experience'] }, { referenceIds: ['old-account-reference'] }]) assert.throws(() => save(state, { ...value, idea: undefined, accountId: 'another-account', ...change }), /切换灵感平台或账号/);
  save(state, { ...value, idea: undefined, accountId: 'another-account' });
  assert.equal(state.agentWorkspace.drafts[`${f.projectId}:inspiration`].idea, undefined);
});

test('twenty terminal failures can be explicitly archived while metadata and old-ID protection survive', t => {
  const f = fixture(t), state = f.store.get(), value = draft(); value.conversation.turns = [];
  for (let index = 0; index < 20; index++) {
    const next = index ? agentWorkspace(state).drafts[`${f.projectId}:inspiration`] : structuredClone(value); next.conversation.turns.push(turn({ user: `失败轮次${index}` })); save(state, next);
    const claim = claimInspirationTurn(state, f.projectId, requestFor(next), randomUUID()); if (index % 2) dispatchInspirationTurn(state, claim); failInspirationTurn(state, claim);
  }
  const full = agentWorkspace(state).drafts[`${f.projectId}:inspiration`]; assert.equal(full.conversation.turns.length, 20);
  const middleRemoved = structuredClone(full); middleRemoved.conversation.turns.splice(1, 1); assert.throws(() => save(state, middleRemoved), /不能删除中间轮次/);
  const shortened = structuredClone(full); shortened.conversation.turns.shift(); save(state, shortened);
  const fresh = draft(); save(state, fresh); assert.equal(Object.keys(state.agentWorkspace.inspirationReceipts).length, 20);
  const receipt = state.agentWorkspace.inspirationReceipts[full.conversation.turns[0].id]; assert.equal(receipt.user, '失败轮次0'); assert.equal(receipt.accountId, 'account-xhs'); assert.equal(receipt.model, 'deepseek-flash'); assert.equal(receipt.reply, undefined);
  fresh.conversation.turns[0].id = full.conversation.turns[0].id; assert.throws(() => save(state, fresh), /不能改写/);
});

test('unclaimed pending turns can be explicitly cancelled after reload, without submission or generated reply', async t => {
  const f = await httpFixture(t), value = draft(); await f.write(value);
  const loaded = (await f.req('/agent-workspace', undefined, 'GET')).data.drafts[`${f.projectId}:inspiration`]; assert.equal(loaded.conversation.turns[0].submittedAt, undefined);
  loaded.conversation.input = loaded.conversation.turns[0].user; loaded.conversation.turns[0].status = 'interrupted'; assert.equal((await f.write(loaded)).status, 200);
  assert.equal((await f.send(loaded)).status, 409); assert.equal(f.calls.length, 0); assert.equal(f.current().conversation.input, value.conversation.turns[0].user);
});

test('unbound project inspiration never inherits the selected platform account identity', async t => {
  const f = await httpFixture(t), value = draft({ accountId: '', idea: undefined }); value.conversation.turns[0].accountId = '';
  f.store.mutate(state => { state.activeCreationAccounts = { xiaohongshu: 'account-xhs' }; state.projects[0].creationSelections = { xiaohongshu: { accountId: 'account-xhs', presetId: '' } }; state.accounts.find(row => row.id === 'account-xhs').name = 'PRIVATE_DEFAULT_IDENTITY'; });
  await f.write(value); assert.equal((await f.send(value)).status, 200); assert.equal(f.calls[0].payload.accountContext, undefined); assert.equal(f.calls[0].payload.agentContext.accountId, ''); assert.doesNotMatch(JSON.stringify(f.calls[0].payload), /PRIVATE_DEFAULT_IDENTITY/);
});

test('encrypted restart preserves private messages, receipts and interruption without resubmission', t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-inspiration-')), file = join(directory, 'state.sqlite'), key = randomBytes(32);
  let store = createStore(file, { key }); t.after(() => { store?.close(); rmSync(directory, { recursive: true, force: true }); });
  const projectId = store.get().projects[0].id, value = draft(); value.conversation.turns[0].user = 'PRIVATE_PERSISTED_MESSAGE'; let claim;
  store.mutate(state => { save(state, value); claim = claimInspirationTurn(state, projectId, requestFor(value), randomUUID()); dispatchInspirationTurn(state, claim); });
  store.close(); store = createStore(file, { key }); assert.equal(store.mutate(state => recoverInspirationTurns(state, new Set([claim.attemptId]))), 0);
  assert.equal(store.mutate(state => recoverInspirationTurns(state)), 1); assert.equal(store.mutate(state => recoverInspirationTurns(state)), 0);
  const restored = store.get().agentWorkspace.drafts[`${projectId}:inspiration`].conversation.turns[0]; assert.equal(restored.status, 'interrupted'); assert.equal(restored.user, 'PRIVATE_PERSISTED_MESSAGE');
  assert(!readFileSync(file).includes(Buffer.from('PRIVATE_PERSISTED_MESSAGE'))); assert.throws(() => store.mutate(state => claimInspirationTurn(state, projectId, requestFor(value), randomUUID())), /已经提交/);
});

test('same conversation/turn IDs remain isolated between authenticated team members and each can recover only their own', t => {
  const base = createStore(':memory:'), store = createTeamStore(base); t.after(() => store.close());
  const a = { userId: 'a', username: 'A', role: 'admin' }, b = { userId: 'b', username: 'B', role: 'editor' }, value = draft(), projectId = base.get().projects[0].id;
  runWithActor(a, () => store.mutate(state => { save(state, value); const claim = claimInspirationTurn(state, projectId, requestFor(value), randomUUID()); dispatchInspirationTurn(state, claim); }));
  runWithActor(b, () => { assert.equal(store.get().agentWorkspace, undefined); store.mutate(state => { const other = structuredClone(value); other.conversation.turns[0].user = 'B_PRIVATE'; save(state, other); const claim = claimInspirationTurn(state, projectId, requestFor(other), randomUUID()); failInspirationTurn(state, claim, { noCharge: true }); }); });
  runWithActor(a, () => { assert.equal(store.mutate(state => recoverInspirationTurns(state)), 1); assert.doesNotMatch(JSON.stringify(store.get()), /B_PRIVATE/); });
  runWithActor(b, () => { assert.equal(store.get().agentWorkspace.drafts[`${projectId}:inspiration`].conversation.turns[0].status, 'failed'); assert.equal(store.mutate(state => recoverInspirationTurns(state)), 0); });
});
