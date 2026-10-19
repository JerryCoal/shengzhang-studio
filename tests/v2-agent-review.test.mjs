import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createModelStore, DEEPSEEK_ROUTES, MODELS } from '../server/models.mjs';
import { createAgentHandoff, resolveAgentContext, agentMediaContext } from '../server/agent-workspace.mjs';
import { createKnowledge, updateContentBrief } from '../server/content-workflow.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { registerReviewWork } from '../server/review-work.mjs';

function fixture(t) {
  const store = createStore(':memory:'); t.after(() => store.close());
  store.mutate(state => {
    const p = state.projects[0]; p.brief.budgetUsd = 100; p.usage = [];
    state.accounts.push({ id: 'xhs-other', name: '另一个账号', platform: 'xiaohongshu' });
    p.experiences = [{ id: 'shared-exp', insightId: 'manual-shared', active: true, text: 'PRIVATE_EXPERIENCE_SOURCE 使用短句结构。' }];
    p.publications = [{ id: 'work-a', accountId: 'account-xhs', platform: 'xiaohongshu', title: 'A 作品' }, { id: 'work-b', accountId: 'xhs-other', platform: 'xiaohongshu', title: 'B 作品' }];
    p.comments = [
      { id: 'comment-a', publicationId: 'work-a', platform: 'xiaohongshu', text: '希望展示冲泡过程。', tags: ['内容建议'], sentiment: 'neutral', importedAt: new Date().toISOString(), irrelevant: false },
      { id: 'comment-b', publicationId: 'work-b', platform: 'xiaohongshu', text: 'OTHER_ACCOUNT_PRIVATE 想看不同的场景。', tags: ['内容建议'], sentiment: 'neutral', importedAt: new Date().toISOString(), irrelevant: false },
    ];
    p.insights = [];
  });
  const projectId = store.get().projects[0].id;
  const input = { accountId: 'account-xhs', platform: 'xiaohongshu', model: 'deepseek-flash', experienceIds: ['shared-exp'] };
  const mutate = work => store.mutate(state => work(state, state.projects[0]));
  const handoff = (extra = {}) => mutate((state, p) => createAgentHandoff(state, p, { ...input, fromAgent: 'inspiration', requestId: randomUUID(), requirement: '午后工作记录', kind: 'image', ...extra }, [], MODELS));
  return { store, projectId, input, mutate, handoff };
}
async function httpFixture(t) {
  const f = fixture(t), calls = [], behavior = {}, models = createModelStore(); models.save(DEEPSEEK_ROUTES);
  const app = createApp(f.store, { profileMode: true, modelStore: models, deepseekVault: { status: () => ({ configured: true, supported: true }), getKey: async () => 'synthetic-key' }, fetcher: async (_url, init) => {
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content); calls.push({ request, payload }); await behavior.run?.(payload);
    const output = payload.task ? { title: '午后的茶', body: '真实的日常记录。', prompt: '茶杯与窗边自然光', scenes: ['茶杯', '桌面', '窗边'] } : payload.comments ? { insights: [{ category: '内容建议', title: '补充过程', observation: '当前样本有一条评论提出演示需求。', recommendation: '补充过程演示并继续观察。', evidenceIds: payload.comments.map(c => c.id) }] } : { title: '午后的茶', core: '日常记录', direction: '自然光', prompt: '采用克制的画面' };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); });
  const req = async (path, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: 'POST', headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  return { ...f, calls, behavior, req, app };
}
function addSkill(state, name, workflowId) {
  return installCreativeSkill(state, { fileName: 'SKILL.md', text: `---\nname: ${name}\ndescription: 分析偏好\nversion: 1.0.0\n---\n# ${name}\n${name} 按样本说明限制，不推断因果。`, workflowId, confirmed: true, expectedRevision: state.skillsRevision || 0 });
}

test('copy inherits latest brief knowledge, preserves packet on partial input and honors explicit model override', async t => {
  const f = await httpFixture(t), knowledge = f.mutate((state, p) => ['OLD_SELECTED_REFERENCE', 'LATEST_SELECTED_REFERENCE'].map(text => createKnowledge(state, p, { kind: 'reference', title: text, text, accountId: 'account-xhs' })));
  const idea = { title: '灵感标题', core: '灵感核心', direction: '灵感方向', prompt: '灵感画面' };
  const asset = f.handoff({ knowledgeIds: [knowledge[0].id], idea });
  f.mutate((state, p) => updateContentBrief(state, p, asset.id, { expectedRevision: 1, requirement: '午后工作记录', knowledgeIds: [knowledge[1].id] }));
  const path = `/projects/${f.projectId}/assets/${asset.id}/copy`;
  const first = await f.req(path, { expectedRevision: 2, modelOverride: 'deepseek-v4-pro' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(f.calls[0].request.model, 'deepseek-v4-pro');
  assert.deepEqual(f.calls[0].payload.knowledgeContext.entries.map(row => row.id), [knowledge[1].id]);
  assert.equal(first.data.result.agentPacket.model, 'deepseek-v4-pro');
  const second = await f.req(path, { expectedRevision: first.data.result.revision, agentInput: { model: 'deepseek-flash' } });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(f.calls[1].request.model, 'deepseek-flash');
  assert.deepEqual(f.calls[1].payload.agentContext.idea, idea);
  assert.deepEqual(f.calls[1].payload.agentContext.experienceIds, ['shared-exp']);
  assert.deepEqual(f.calls[1].payload.knowledgeContext.entries.map(row => row.id), [knowledge[1].id]);
  const third = await f.req(path, { expectedRevision: second.data.result.revision, agentInput: { knowledgeIds: [knowledge[0].id] } });
  assert.equal(third.status, 200, JSON.stringify(third.data));
  assert.deepEqual(third.data.result.contentBrief.knowledgeIds, [knowledge[0].id]);
  const p = f.store.get().projects[0], media = agentMediaContext(p, p.assets.find(a => a.id === asset.id));
  assert.deepEqual(media.knowledge.entries.map(row => row.id), [knowledge[0].id]);
  const fourth = await f.req(path, { expectedRevision: third.data.result.revision, agentInput: { knowledgeIds: [], experienceIds: [] } });
  assert.equal(fourth.status, 200, JSON.stringify(fourth.data));
  assert.deepEqual(fourth.data.result.contentBrief.knowledgeIds, []);
  assert.deepEqual(fourth.data.result.agentPacket.experienceIds, []);
});

test('legacy evidence ownership and missing source cannot become shared experiences in text or media', t => {
  const f = fixture(t), asset = f.handoff();
  f.mutate((_state, p) => {
    p.experiences[0].insightId = 'legacy-insight';
    p.insights.push({ id: 'legacy-insight', evidenceIds: ['comment-b'] });
  });
  const state = f.store.get(), p = state.projects[0];
  assert.throws(() => resolveAgentContext(state, p, f.input, 'copy', MODELS), /其他账号/);
  assert.throws(() => agentMediaContext(p, p.assets.find(a => a.id === asset.id)), /其他账号/);
  p.insights[0] = { id: 'legacy-insight', publicationIds: ['removed-publication'], evidenceIds: [] };
  assert.throws(() => resolveAgentContext(state, p, f.input, 'copy', MODELS), /无法核对账号归属/);
  assert.throws(() => agentMediaContext(p, p.assets.find(a => a.id === asset.id)), /无法核对账号归属/);
});

test('analysis selected Skills reach provider with account-scoped evidence and immutable local usage trace', async t => {
  const f = await httpFixture(t), skills = f.mutate(state => [addSkill(state, 'analysis-alpha', 'analysis'), addSkill(state, 'analysis-beta', 'analysis')]);
  const response = await f.req(`/projects/${f.projectId}/analysis`, { mode: 'openai', commentIds: ['comment-a'], agentInput: { model: 'deepseek-flash', skillIds: skills.map(s => s.id) } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const { request, payload } = f.calls[0];
  assert.deepEqual(payload.agentContext.skills.map(s => s.id), skills.map(s => s.id));
  assert.match(JSON.stringify(payload), /analysis-alpha.*analysis-beta/);
  assert.match(request.messages[0].content, /分析 Agent 的选定规则/);
  assert.match(request.messages[0].content, /不同账号或平台/);
  assert.equal(payload.comments[0].accountId, 'account-xhs');
  assert.doesNotMatch(JSON.stringify(payload), /OTHER_ACCOUNT_PRIVATE|PRIVATE_EXPERIENCE_SOURCE/);
  const state = f.store.get(), trace = state.projects[0].usage.at(-1).skillTrace;
  assert.deepEqual(trace.selected.map(s => s.id), skills.map(s => s.id));
  const snapshot = structuredClone(trace.selected);
  f.mutate(s => { s.installedSkills.find(s => s.id === skills[0].id).instructions = 'changed later'; });
  assert.deepEqual(f.store.get().projects[0].usage.at(-1).skillTrace.selected, snapshot);
  removeWebSkillHistory(state); assert.doesNotMatch(JSON.stringify(state), /analysis-alpha|analysis-beta/);
});

test('Agent experience source stays private instead of being mechanically appended to generated strategy', async t => {
  const f = await httpFixture(t);
  const response = await f.req(`/projects/${f.projectId}/strategies`, { mode: 'openai', instruction: '生成日常灵感', agentInput: f.input });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.match(JSON.stringify(f.calls[0].payload.agentContext), /PRIVATE_EXPERIENCE_SOURCE/);
  assert.match(f.calls[0].request.messages[0].content, /最高优先级/);
  assert.deepEqual(response.data.result.feedbackIds, ['shared-exp']);
  const result = structuredClone(response.data.result); removeWebSkillHistory(result);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EXPERIENCE_SOURCE/);
});

test('external review registration rejects mismatched accounts and gives useful invalid-link feedback', async t => {
  const f = await httpFixture(t), path = `/projects/${f.projectId}/review-works`, url = 'https://www.xiaohongshu.com/explore/65a000000000000000000001';
  const bad = await f.req(path, { confirmed: true, accountId: 'account-xhs', title: '测试作品', url: 'https://www.xiaohongshu.com/user/profile/not-a-work' });
  assert.equal(bad.status, 400, JSON.stringify(bad.data)); assert.match(bad.data.error, /完整作品详情链接/);
  const first = await f.req(path, { confirmed: true, accountId: 'account-xhs', title: '测试作品', url });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const again = await f.req(path, { confirmed: true, accountId: 'account-xhs', title: '标题变动不应重复', url: url.replace('/explore/', '/discovery/item/') + '?source=share' });
  assert.equal(again.data.result.id, first.data.result.id);
  assert.equal((await f.req(path, { confirmed: true, accountId: 'xhs-other', title: '误绑另一账号', url })).status, 409);
  f.mutate((_state, p) => { p.publications.find(row => row.id === first.data.result.id).url = ''; });
  const state = f.store.get(), p = state.projects[0];
  const recovered = registerReviewWork(state, p, { confirmed: true, accountId: 'account-xhs', title: '恢复链接', url });
  assert.equal(recovered.id, first.data.result.id); assert.equal(p.publications.filter(row => row.platformItemId === '65a000000000000000000001').length, 1);
});
