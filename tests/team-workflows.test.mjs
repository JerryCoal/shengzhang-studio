import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { currentActor, runWithActor } from '../server/request-actor.mjs';
import { canUseCredentials } from '../server/ai-routes.mjs';
import { canUseTeamWorkspace } from '../server/workspace-access.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { saveAccountCreationProfile } from '../server/account-creation.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';

const actors = { alice: { userId: 'alice', username: 'Alice', role: 'admin' }, bob: { userId: 'bob', username: 'Bob', role: 'editor' } };
function vault(initial = '') {
  let value = initial;
  return { status: () => ({ supported: true, configured: !!value }), getKey: async () => value, save: async next => { value = next; }, remove: () => { value = ''; } };
}
const accounts = { version: 2, activeAccountId: 'a', accounts: [{ id: 'a', name: '校园账号', mode: 'external', endpoint: 'http://127.0.0.1:18060/mcp' }, { id: 'b', name: '职场账号', mode: 'external', endpoint: 'http://127.0.0.1:18061/mcp' }] };
async function fixture(t, onCall = async () => ({ content: [{ type: 'text', text: '✅ 已登录\nfixture' }] }), extra = {}) {
  const base = createStore(':memory:'), store = createTeamStore(base), mcpVault = vault(JSON.stringify(accounts)), calls = [];
  const mcpFetcher = async (url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const request = JSON.parse(init.body);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const tools = ['check_login_status', 'get_feed_detail'].map(name => ({ name, inputSchema: { type: 'object', required: [] } }));
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } } : request.method === 'tools/list' ? { tools } : await (async () => { calls.push({ url, ...request.params }); return onCall(request.params.name, request.params.arguments); })();
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  const app = createApp(store, { teamMode: true, profileMode: true, workspaceName: '工作室', getActor: currentActor, authorizeCredentials: req => !!req.teamUser, mcpVaults: { xiaohongshu: mcpVault }, qwenVault: vault('sk-fixture-only'), vault: vault('sk-fixture-only'), mcpFetcher, ...extra });
  const host = express();
  // Test-only identity injection. Production team sessions are verified by the
  // team server and never accept this header.
  host.use((req, _res, next) => { req.teamUser = actors[req.get('X-Test-Actor')]; runWithActor(req.teamUser, next); });
  host.use(app);
  const server = host.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); base.close(); });
  const req = async (actor, path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json', 'X-Test-Actor': actor || '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  return { req, base, store, mcpVault, calls, app, projectId: base.get().projects[0].id };
}

test('team default Skill edits are admin-only, shared, revision-checked and attributed without recording text in activity', async t => {
  const f = await fixture(t);
  const admin = (await f.req('alice', '/creative-skills')).data, editor = (await f.req('bob', '/creative-skills')).data;
  assert.equal(admin.defaultEditable, true); assert.equal(editor.defaultEditable, false);
  const body = { workflowId: 'research-analysis', skillId: 'research-analysis', instructions: 'TEAM_DEFAULT_PRIVATE_BODY', expectedRevision: admin.revision };
  assert.equal((await f.req('bob', '/creative-skills/default', body, 'PUT')).status, 403);
  assert.equal((await f.req('', '/creative-skills/default', body, 'PUT')).status, 403);
  assert.equal((await f.req('alice', '/creative-skills/default', body, 'PUT')).status, 200);
  const after = (await f.req('bob', '/creative-skills')).data;
  assert.equal(after.workflows.find(item => item.id === 'research-analysis').skills[0].instructions, body.instructions);
  assert.equal(after.revision, admin.revision + 1);
  assert.equal((await f.req('alice', '/creative-skills/default', body, 'PUT')).status, 409);
  const reset = { workflowId: body.workflowId, skillId: body.skillId, expectedRevision: after.revision };
  assert.equal((await f.req('bob', '/creative-skills/default', reset, 'DELETE')).status, 403);
  assert.equal((await f.req('alice', '/creative-skills/default', reset, 'DELETE')).status, 200);
  const state = (await f.req('alice', '/state')).data;
  assert(!JSON.stringify(state.activities).includes(body.instructions));
  assert.equal(state.activities[0].actor?.userId, 'alice');
});

test('team credential access cannot fall back to loopback or a permissive callback without a verified member', () => {
  const request = { get: name => name === 'Host' ? 'localhost' : '', socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(canUseCredentials(request, { teamMode: true, authorizeCredentials: () => true }), false);
  assert.equal(canUseTeamWorkspace({ ...request, teamUser: actors.bob }, { teamMode: true }), false);
  assert.equal(canUseCredentials({ ...request, teamUser: actors.bob }, { teamMode: true, authorizeCredentials: () => true }), true);
  assert.equal(canUseTeamWorkspace({ ...request, teamUser: actors.bob }, { authorizeCredentials: () => true }), false, 'stateless relay never becomes a team workspace');
});

test('team members can use encrypted-workspace features while settings expose credential edit rights', async t => {
  const f = await fixture(t);
  const settings = (await f.req('bob', '/settings')).data;
  assert.deepEqual(settings.team, { ...actors.bob, workspaceName: '工作室' });
  assert.equal(settings.credential.local, true); assert.equal(settings.credential.editable, false);
  assert.equal(settings.providers.qwen.credential.editable, false);
  assert.equal((await f.req('alice', '/settings')).data.credential.editable, true);
  for (const path of [`/projects/${f.projectId}/corpus/context`, '/brief-import?editorKey=new', '/mcp/settings']) {
    assert.equal((await f.req('bob', path)).status, 200, path);
    assert.equal((await f.req('', path)).status, 403, `anonymous ${path}`);
  }
  for (const path of [`/projects/${f.projectId}/corpus/rag`, '/research/settings']) {
    assert.equal((await f.req('bob', path)).data.available, true, path);
    assert.equal((await f.req('', path)).data.available, false, `anonymous ${path}`);
  }
});

test('MCP selections and generation defaults are per member and never rewrite the vault default', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('alice', '/mcp/xiaohongshu/accounts/b/activate', {})).status, 200);
  const alice = (await f.req('alice', '/mcp/settings')).data.platforms.find(p => p.platform === 'xiaohongshu');
  const bob = (await f.req('bob', '/mcp/settings')).data.platforms.find(p => p.platform === 'xiaohongshu');
  assert.equal(alice.accountId, 'b'); assert.equal(bob.accountId, 'a'); assert.equal(bob.editable, false);
  assert.equal(JSON.parse(await f.mcpVault.getKey()).activeAccountId, 'a');
  const aState = (await f.req('alice', '/state')).data, bState = (await f.req('bob', '/state')).data;
  assert.equal(aState.activeCreationAccounts.xiaohongshu, 'mcp-xiaohongshu-b');
  assert.equal(bState.activeCreationAccounts.xiaohongshu, 'mcp-xiaohongshu-a');
  assert.equal(aState.teamPreferences, undefined); assert.equal(bState.teamPreferences, undefined);
  assert.equal((await f.req('bob', '/mcp/xiaohongshu/login-status', { accountId: 'a' })).status, 200);
  assert.equal(f.calls.at(-1).url, 'http://127.0.0.1:18060/mcp');
  assert.equal((await f.req('alice', '/mcp/settings')).data.platforms[0].connected, false, 'another account check cannot be shown as this account status');
});

test('MCP tasks snapshot the member account and prevent shared upstream changes until completion', async t => {
  let entered, release;
  const begun = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async () => { entered(); await new Promise(resolve => { release = resolve; }); return { content: [{ type: 'text', text: '✅ 已登录\nfixture' }] }; });
  await f.req('alice', '/mcp/xiaohongshu/accounts/b/activate', {});
  const pending = f.req('alice', '/mcp/xiaohongshu/login-status', { accountId: 'b' });
  await begun;
  assert.equal((await f.req('bob', '/mcp/xiaohongshu/accounts/b/activate', {})).status, 409);
  assert.equal((await f.req('bob', '/mcp/xiaohongshu/login-status', { accountId: 'a' })).status, 409);
  release(); assert.equal((await pending).status, 200);
  assert.equal(f.calls[0].url, 'http://127.0.0.1:18061/mcp');
  assert.equal((await f.req('bob', '/mcp/settings')).data.platforms[0].accountId, 'a');
});

test('comment previews cannot be adopted by another team member', async t => {
  const itemId = 'a'.repeat(24), url = `https://www.xiaohongshu.com/explore/${itemId}?xsec_token=fixture`;
  const f = await fixture(t, async () => ({ content: [{ type: 'text', text: JSON.stringify({ feed_id: itemId, data: { note: { noteId: itemId }, comments: { list: [{ id: 'c-1', noteId: itemId, content: '真实反馈', likeCount: 0 }] } } }) }] }));
  f.base.mutate(state => state.projects[0].publications.push({ id: 'pub', status: 'published', sample: false, platform: 'xiaohongshu', accountId: 'mcp-xiaohongshu-a', url }));
  const path = `/projects/${f.projectId}/publications/pub/mcp/comments`;
  const preview = await f.req('alice', path, { accountId: 'a' });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const input = { previewId: preview.data.previewId, confirmed: true, indices: [0] };
  assert.equal((await f.req('bob', path + '/import', input)).status, 409);
  assert.equal((await f.req('alice', path + '/import', input)).status, 200);
});

test('team generation keeps the initiating member identity while another member chooses a different account', async t => {
  let entered, release;
  const begun = new Promise(resolve => { entered = resolve; }), inputs = [];
  const f = await fixture(t, undefined, { fetcher: async (_url, init) => {
    inputs.push(JSON.parse(JSON.parse(init.body).input)); entered(); await new Promise(resolve => { release = resolve; });
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: '日常观察', body: '描述用户提供的场景。', prompt: '自然光', scenes: ['开场', '细节', '结尾'] }) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  await f.req('alice', '/mcp/settings');
  f.base.mutate(state => {
    const project = state.projects[0]; confirmStrategy(project, project.strategies[0].id); project.brief.budgetUsd = 100;
    for (const id of ['a', 'b']) saveAccountCreationProfile(state, `mcp-xiaohongshu-${id}`, { expectedRevision: 0, identityMarkdown: `TEAM_IDENTITY_${id}`, identityFileName: '身份.md', presets: [], defaultPresetId: '' });
  });
  const current = () => f.base.get().projects[0], asset = () => current().assets.find(item => item.channel === 'xiaohongshu');
  const pending = f.req('alice', `/projects/${f.projectId}/assets/${asset().id}/copy`, { expectedRevision: asset().revision });
  await begun;
  try {
    assert.equal((await f.req('bob', `/projects/${f.projectId}/creation-selection`, { platform: 'xiaohongshu', accountId: 'mcp-xiaohongshu-b', expectedRevision: current().revision }, 'PUT')).status, 200);
  } finally { release(); }
  const result = await pending; assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.result.creationTrace.accounts[0].accountId, 'mcp-xiaohongshu-a');
  assert.equal(inputs[0].accountContext.accounts[0].identityMarkdown, 'TEAM_IDENTITY_a');
  assert(!JSON.stringify(inputs[0]).includes('TEAM_IDENTITY_b'));
  const alice = (await f.req('alice', '/state')).data.projects[0], bob = (await f.req('bob', '/state')).data.projects[0];
  assert.equal(alice.creationSelections, undefined); assert.equal(bob.creationSelections.xiaohongshu.accountId, 'mcp-xiaohongshu-b');
});

const frameData = 'data:image/png;base64,iVBORw0KGgo=';
const videoData = 'data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb20=';
function videoSettings() { const preferences = createIntegrationPreferences(); preferences.save({ region: 'volcengine', model: 'fixture-seedance', reservationUsd: 2, outputPriceUsd: 1 }); return preferences; }
function prepareVideo(f, old = false) {
  let assetId;
  f.base.mutate(state => {
    const project = state.projects[0]; confirmStrategy(project, project.strategies[0].id); project.brief.budgetUsd = 100;
    const asset = project.assets.find(item => item.kind === 'video'); assetId = asset.id;
    asset.aiProduction = { id: 'production', assetRevision: asset.revision, phase: old ? 'uncertain' : 'frames', frames: ['first_frame', 'last_frame'].map(role => ({ id: role, role, mediaData: frameData })), ...(old ? { taskId: 'old-task', videoUsageId: 'old-usage', provider: 'volcengine', outputPriceUsd: 1, initiatedBy: actors.alice } : {}) };
    if (old) project.usage.push({ id: 'old-usage', stage: 'video', status: 'running', amountUsd: 2, estimated: true });
  });
  return { asset: () => f.base.get().projects[0].assets.find(item => item.id === assetId), path: `/projects/${f.projectId}/assets/${assetId}` };
}
async function until(check) { for (let count = 0; count < 200; count++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Synthetic media job did not finish'); }

test('video timer completion and persisted usage retain the initiating member after the request ends', async t => {
  const actorsSeen = [];
  const f = await fixture(t, undefined, { integrationPreferences: videoSettings(), seedanceVault: vault('synthetic-only'), downloadVideo: async () => videoData, fetcher: async (_url, init) => {
    actorsSeen.push(currentActor());
    return init.method === 'POST' ? Response.json({ id: 'video-task' }) : Response.json({ id: 'video-task', status: 'succeeded', usage: { completion_tokens: 20 }, content: { video_url: 'https://fixture.invalid/video.mp4' } });
  } });
  const video = prepareVideo(f);
  const created = await f.req('alice', video.path + '/seedance', { productionId: 'production', expectedRevision: video.asset().revision, prompt: '自然运镜', duration: 5, generateAudio: false, confirmed: true });
  assert.equal(created.status, 202, JSON.stringify(created));
  await until(() => video.asset().aiProduction.phase === 'generating-video');
  assert.deepEqual(video.asset().aiProduction.initiatedBy, actors.alice);
  assert.deepEqual(f.base.get().projects[0].usage.at(-1).actor, actors.alice);
  f.base.mutate(state => { state.projects[0].assets.find(item => item.id === video.asset().id).aiProduction.nextPollAt = 0; });
  await runWithActor(null, () => f.app.locals.integrations.tick());
  assert.equal(video.asset().aiProduction.phase, 'complete');
  const completions = f.base.get().activities.filter(item => item.title === 'AI 视频已生成');
  assert.equal(completions.length, 1); assert.deepEqual(completions[0].actor, actors.alice);
  assert(actorsSeen.every(actor => actor.userId === actors.alice.userId));
  assert.equal((await f.req('bob', video.path + '/video-status', {})).status, 200);
  assert.equal(f.base.get().activities.filter(item => item.title === 'AI 视频已生成').length, 1);
});

test('an old manual video poll cannot change a replacement task after reset', async t => {
  let entered, release;
  const begun = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, undefined, { integrationPreferences: videoSettings(), seedanceVault: vault('synthetic-only'), fetcher: async (_url, init) => {
    if (init.method === 'POST') return Response.json({ id: 'new-task' });
    assert.equal(currentActor().userId, 'alice', 'Bob refresh keeps the stored initiating actor');
    entered(); await new Promise(resolve => { release = resolve; });
    return Response.json({ id: 'old-task', status: 'failed', usage: { completion_tokens: 20 } });
  } });
  const video = prepareVideo(f, true);
  const oldPoll = f.req('bob', video.path + '/video-status', {}); await begun;
  try {
    assert.equal((await f.req('alice', video.path + '/generation-reset', { confirmed: true })).status, 200);
    const created = await f.req('alice', video.path + '/seedance', { productionId: 'production', expectedRevision: video.asset().revision, prompt: '自然运镜', duration: 5, generateAudio: false, confirmed: true });
    assert.equal(created.status, 202, JSON.stringify(created));
    await until(() => video.asset().aiProduction.taskId === 'new-task');
  } finally { release(); }
  assert.equal((await oldPoll).status, 200);
  assert.equal(video.asset().aiProduction.phase, 'generating-video'); assert.equal(video.asset().aiProduction.taskId, 'new-task');
  assert.equal(f.base.get().projects[0].usage.find(item => item.id === 'old-usage').status, 'failed');
  assert.equal(f.base.get().projects[0].usage.at(-1).status, 'running');
});
