import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createModelStore, DEEPSEEK_ROUTES, MODELS } from '../server/models.mjs';
import { agentWorkspace, saveAgentWorkspace, createAgentHandoff, resolveAgentContext } from '../server/agent-workspace.mjs';
import { createKnowledge } from '../server/content-workflow.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';

function fixture(t) {
  const store = createStore(':memory:'); t.after(() => store.close());
  const state = store.get(), project = state.projects[0];
  project.brief.budgetUsd = 100; project.usage = [];
  state.accounts.push({ id: 'xhs-b', name: 'B', platform: 'xiaohongshu' });
  project.experiences = [{ id: 'exp-a', active: true, insightId: 'shared', text: 'SELECTED_EXPERIENCE 短句优先。' }, { id: 'exp-b', active: true, insightId: 'b', text: 'UNSELECTED_PRIVATE 其他账号经验。' }];
  project.insights = [{ id: 'b', publicationIds: ['publication-b'], evidenceIds: [] }];
  project.publications.push({ id: 'publication-b', accountId: 'xhs-b' });
  const input = { accountId: 'account-xhs', platform: 'xiaohongshu', model: 'deepseek-flash', experienceIds: ['exp-a'] };
  const handoff = extra => createAgentHandoff(state, project, { ...input, fromAgent: 'inspiration', requestId: randomUUID(), requirement: '办公记录', kind: 'image', ...extra }, [], MODELS);
  return { store, state, project, input, handoff };
}
function skill(state, name, workflowId) {
  return installCreativeSkill(state, { fileName: 'SKILL.md', text: `---\nname: ${name}\ndescription: 写作规则\nversion: 1.0.0\n---\n# ${name}\n使用明确短句，保留已核实事实。`, workflowId, confirmed: true, expectedRevision: state.skillsRevision || 0 });
}
test('Agent draft autosave is revision checked, project scoped and not generation', t => {
  const f = fixture(t), key = `${f.project.id}:inspiration`, draft = { ...f.input, requirement: 'PRIVATE_DRAFT', kind: 'image' };
  const first = saveAgentWorkspace(f.state, { expectedRevision: 0, key, draft });
  assert.equal(first.revision, 1); assert.equal(first.drafts[key].requirement, 'PRIVATE_DRAFT');
  assert.throws(() => saveAgentWorkspace(f.state, { expectedRevision: 0, key, draft }), /另一窗口/);
  assert.throws(() => saveAgentWorkspace(f.state, { expectedRevision: 1, key: 'missing:inspiration', draft }), /不存在/);
  assert.throws(() => saveAgentWorkspace(f.state, { expectedRevision: 1, key, draft: { ...draft, credentials: {} } }), /Unrecognized|unrecognized/);
  first.drafts[key].requirement = 'mutated'; assert.equal(agentWorkspace(f.state).drafts[key].requirement, 'PRIVATE_DRAFT');
  assert.equal(f.project.usage.length, 0);
});
test('handoff is idempotent, preserves idea and explicit experience without changing account', t => {
  const f = fixture(t), requestId = randomUUID(), idea = { title: '一杯茶的记录', core: '静态记录', direction: '自然光', prompt: '不虚构故事' };
  const a = f.handoff({ requestId, idea }); assert.equal(f.handoff({ requestId, idea }).id, a.id);
  assert.equal(a.agentPacket.context.experiences[0].id, 'exp-a'); assert.equal(a.contentBrief.accountId, 'account-xhs');
  assert.deepEqual(a.agentPacket.idea, idea); assert.doesNotMatch(JSON.stringify(a), /UNSELECTED_PRIVATE/);
  assert.throws(() => f.handoff({ requestId, idea, requirement: '新输入' }), /输入已变化/);
  assert.throws(() => f.handoff({ accountId: 'xhs-b', platform: 'douyin' }), /不一致/);
  assert.throws(() => f.handoff({ experienceIds: ['exp-b'] }), /其他账号/);
});
test('multiple Skills are resolved from installed rules for the selected workflow only', t => {
  const f = fixture(t), a = skill(f.state, 'short-copy', 'copy-xiaohongshu'), b = skill(f.state, 'clear-copy', 'copy-xiaohongshu'), wrong = skill(f.state, 'strategy-rule', 'strategy');
  const c = resolveAgentContext(f.state, f.project, { ...f.input, skillIds: [a.id, b.id] }, 'copy', MODELS);
  assert.deepEqual(c.skills.map(s => s.id), [a.id, b.id]); assert(c.skills.every(s => s.instructions.includes('明确短句')));
  assert.throws(() => f.handoff({ skillIds: [wrong.id] }), /不适用/);
  f.state.installedSkills.find(s => s.id === b.id).enabled = false;
  assert.throws(() => f.handoff({ skillIds: [b.id] }), /停用/);
  const k = createKnowledge(f.state, f.project, { kind: 'experience', title: '私有经验', text: 'B_PRIVATE', accountId: 'xhs-b' });
  assert.throws(() => f.handoff({ knowledgeIds: [k.id] }), /其他账号/);
});
test('Agent and task state remain private on relay, and remote injection cannot replace local packets', t => {
  const f = fixture(t), a = f.handoff({ publishingNotes: 'PRIVATE_PACKET' });
  f.state.agentWorkspace = { revision: 1, drafts: { private: { requirement: 'PRIVATE_DRAFT' } } }; f.state.taskJournal = [{ checkpoint: 'PRIVATE_CHECKPOINT' }];
  const base = structuredClone(f.state); removeWebSkillHistory(base);
  assert.doesNotMatch(JSON.stringify(base), /PRIVATE_DRAFT|PRIVATE_CHECKPOINT|PRIVATE_PACKET/);
  const remote = structuredClone(base), p = remote.projects[0]; p.agentHandoffs = [{ input: 'REMOTE_INJECTION' }]; p.assets.find(v => v.id === a.id).agentPacket = { accountId: 'xhs-b', context: 'REMOTE_INJECTION' };
  const merged = mergeRelayState(base, remote, f.state);
  assert.deepEqual(merged.agentWorkspace, f.state.agentWorkspace); assert.deepEqual(merged.taskJournal, f.state.taskJournal);
  assert.deepEqual(merged.projects[0].assets.find(v => v.id === a.id).agentPacket, a.agentPacket); assert.doesNotMatch(JSON.stringify(merged), /REMOTE_INJECTION/);
});

async function httpFixture(t) {
  const f = fixture(t), calls = [], behavior = {}, models = createModelStore(); models.save(DEEPSEEK_ROUTES); f.store.mutate(s => Object.assign(s, f.state));
  const vault = { status: () => ({ configured: true, supported: true }), getKey: async () => 'synthetic-key' };
  const app = createApp(f.store, { profileMode: true, modelStore: models, deepseekVault: vault, fetcher: async (_url, init) => {
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content); calls.push({ request, payload }); await behavior.run?.(payload);
    const output = payload.task ? { title: '办公茶记', body: '真实记录。', prompt: '自然光', scenes: ['茶杯', '桌面', '窗边'] } : { title: '办公茶记', core: '真实记录', direction: '自然光', prompt: '短句创作' };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); });
  const req = async (path, body, method = 'POST') => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() }; };
  return { ...f, app, calls, req, behavior, models };
}
test('inspiration applies explicit experiences, scoped account and per-call model without changing shared defaults', async t => {
  const f = await httpFixture(t), path = `/projects/${f.project.id}/strategies`;
  const r = await f.req(path, { mode: 'openai', instruction: '办公茶记', agentInput: { ...f.input, model: 'deepseek-flash' } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(f.calls[0].request.model, 'deepseek-flash');
  assert.equal(f.models.get().strategy, DEEPSEEK_ROUTES.strategy); assert.deepEqual(f.calls[0].payload.brief.channels, ['xiaohongshu']);
  assert.match(f.calls[0].request.messages[0].content, /最高优先级/); assert.doesNotMatch(JSON.stringify(f.calls), /UNSELECTED_PRIVATE/);
  assert.deepEqual(r.data.result.feedbackIds, ['exp-a']); assert.doesNotMatch(r.data.result.prompt, /UNSELECTED_PRIVATE/);
});
test('copy inherits packet and rejects account rebinding, stale experience and unsupported model without stuck locks', async t => {
  const f = await httpFixture(t), base = `/projects/${f.project.id}`;
  const h = await f.req(base + '/agent-handoffs', { ...f.input, fromAgent: 'inspiration', requestId: randomUUID(), requirement: '工作午后', kind: 'image' }); assert.equal(h.status, 200, JSON.stringify(h.data)); const a = h.data.result;
  const path = base + `/assets/${a.id}/copy`;
  const bad = await f.req(path, { expectedRevision: 1, modelOverride: 'missing', agentInput: { ...f.input, model: 'missing' } }); assert.equal(bad.status, 400); assert.equal(f.app.locals.activeJobs.size, 0);
  assert.equal((await f.req(path, { expectedRevision: 1, agentInput: { ...f.input, accountId: 'xhs-b' } })).status, 409);
  f.behavior.run = () => f.store.mutate(s => { s.projects[0].experiences[0].text = 'Changed after dispatch'; });
  const stale = await f.req(path, { expectedRevision: 1 }); assert.equal(stale.status, 409); assert.equal(f.calls.length, 1);
  assert.equal(f.store.get().projects[0].assets.find(v => v.id === a.id).body, ''); assert.equal(f.app.locals.activeJobs.size, 0);
  f.behavior.run = null; const good = await f.req(path, { expectedRevision: 1 }); assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.equal(good.data.result.agentPacket.accountId, 'account-xhs'); assert.equal(good.data.result.agentPacket.context.experiences[0].text, 'Changed after dispatch');
});
