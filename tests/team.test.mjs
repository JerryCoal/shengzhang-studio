import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createTeamApp, teamOrigin } from '../server/team-app.mjs';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { runWithActor, currentActor } from '../server/request-actor.mjs';
import { teamPermission } from '../server/team-permissions.mjs';
import { openTeamStorage } from '../server/team-storage.mjs';

const password = 'team-test-only-password-2026';
async function fixture(t, workspaceOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-team-'));
  let app, server, base;
  async function start() {
    app = await createTeamApp({ dataDirectory: directory, publicOrigin: 'https://team.test', restrictDirectory: false, protectWithDPAPI: true, transform: async (_, value) => Buffer.from(value), workspaceOptions });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (!server) return; const closed = new Promise(accept => server.close(accept)); server.closeIdleConnections(); await app.locals.close(); await closed; server = null; }
  await start();
  t.after(async () => { await stop(); if (!directory.startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup'); rmSync(directory, { recursive: true }); });
  const request = (path, method = 'GET', body, token = '', headers = {}) => new Promise((accept, reject) => {
    const req = httpRequest(base + '/api' + path, { method, headers: { Host: 'team.test', Origin: 'https://team.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.20', 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, res => {
      let content = ''; res.setEncoding('utf8'); res.on('data', part => { content += part; }); res.on('end', () => { try { accept({ status: res.statusCode, data: JSON.parse(content) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const login = async username => { const result = await request('/profiles/login', 'POST', { username, password }); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const setup = async () => { const result = await request('/team/setup', 'POST', { username: 'owner', password, setupCode: readFileSync(join(directory, 'setup.code'), 'utf8') }); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const add = async (owner, username, role = 'editor') => { const result = await request('/team/users', 'POST', { username, password, role }, owner.token); assert.equal(result.status, 201, JSON.stringify(result)); return login(username); };
  return { request, login, setup, add, directory, restart: async () => { await stop(); await start(); } };
}

test('team bootstrap is one-time, requires host setup code, and never exposes remembered local users', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).data.setupRequired, true);
  assert.equal((await f.request('/state')).status, 401);
  assert.equal((await f.request('/team/setup', 'POST', { username: 'owner', password, setupCode: 'wrong' })).status, 401);
  assert.equal((await f.request('/health', 'GET', undefined, '', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('/health', 'GET', undefined, '', { Host: 'evil.test' })).status, 403);
  const owner = await f.setup();
  assert.equal(owner.role, 'admin'); assert(!existsSync(join(f.directory, 'setup.code')));
  assert.equal((await f.request('/health')).data.setupRequired, false);
  assert.equal((await f.request('/team/setup', 'POST', { username: 'other', password, setupCode: 'wrong' })).status, 409);
  assert.equal((await f.request('/profiles/register', 'POST', { username: 'intruder', password })).status, 403);
  assert.equal((await f.request('/profiles/quick', 'POST', { id: owner.userId })).status, 403);
  assert.deepEqual((await f.request('/profiles/remembered')).data, { supported: false, users: [] });
});

test('team roles restrict credentials, connection writes and publishing, including route casing', async t => {
  const f = await fixture(t), owner = await f.setup(), editor = await f.add(owner, 'writer'), publisher = await f.add(owner, 'publisher', 'publisher');
  assert.equal((await f.request('/team/users', 'GET', undefined, editor.token)).status, 403);
  for (const path of ['/settings/credential', '/Settings/Credential', '/settings/models', '/integrations/seedream', '/research/settings', '/team/feishu', '/mcp/xiaohongshu']) {
    const response = await f.request(path, 'PUT', { apiKey: 'sk-fixture-only-long-enough-key' }, editor.token);
    assert.equal(response.status, 403, path);
  }
  assert.equal((await f.request('/mcp/xiaohongshu/login', 'POST', {}, editor.token)).status, 403);
  assert.equal((await f.request('/projects/missing/publications', 'POST', {}, editor.token)).status, 403);
  assert.equal((await f.request('/projects/missing/publications/item/platform-item', 'POST', {}, editor.token)).status, 403);
  assert.equal((await f.request('/projects/missing/publications/item/platform-status', 'POST', {}, editor.token)).status, 403);
  assert.equal((await f.request('/projects/missing/publications', 'POST', {}, publisher.token)).status, 404);
  assert.equal((await f.request('/settings/credential', 'PUT', { apiKey: 'sk-fixture-only-long-enough-key' }, owner.token)).status, 200);
  const settings = (await f.request('/settings', 'GET', undefined, editor.token)).data;
  assert.equal(settings.openaiConfigured, true); assert.equal(settings.team.userId, editor.userId); assert.equal(settings.credential.editable, false);
  assert.equal((await f.request(`/team/users/${owner.userId}`, 'PATCH', { disabled: true }, owner.token)).status, 409);
});

test('members share projects with actor attribution and optimistic edits, while logout preserves service', async t => {
  const f = await fixture(t), owner = await f.setup(), editor = await f.add(owner, 'writer');
  const seed = (await f.request('/state', 'GET', undefined, owner.token)).data.projects[0];
  const made = await f.request('/projects', 'POST', { ...seed.brief, name: 'TEAM_SHARED_PROJECT' }, editor.token);
  assert.equal(made.status, 201); const p = made.data.result;
  let state = (await f.request('/state', 'GET', undefined, owner.token)).data;
  assert(state.projects.some(item => item.id === p.id));
  assert(state.activities.some(item => item.title === '新项目已创建' && item.actor?.userId === editor.userId));
  assert.equal(state.teamPreferences, undefined);
  assert.equal((await f.request(`/projects/${p.id}`, 'PATCH', { brief: { ...p.brief, name: 'Owner update' }, expectedRevision: p.revision }, owner.token)).status, 200);
  assert.equal((await f.request(`/projects/${p.id}`, 'PATCH', { brief: { ...p.brief, name: 'Stale editor update' }, expectedRevision: p.revision }, editor.token)).status, 409);
  await f.request('/profiles/logout', 'POST', {}, owner.token);
  assert.equal((await f.request('/state', 'GET', undefined, owner.token)).status, 401);
  assert.equal((await f.request('/state', 'GET', undefined, editor.token)).status, 200);
  assert.equal((await f.request('/progress-version', 'GET', undefined, editor.token)).data.workspaceVersion, (await f.request('/state', 'GET', undefined, editor.token)).data.teamRevision);
});

test('team identity selections and unsaved drafts are per member, account identities remain shared', async t => {
  const f = await fixture(t), owner = await f.setup(), editor = await f.add(owner, 'writer');
  const a = (await f.request('/accounts', 'POST', { platform: 'xiaohongshu', name: '生活A' }, owner.token)).data.result;
  const b = (await f.request('/accounts', 'POST', { platform: 'xiaohongshu', name: '知识B' }, owner.token)).data.result;
  let p = (await f.request('/state', 'GET', undefined, owner.token)).data.projects[0];
  assert.equal((await f.request(`/projects/${p.id}/creation-selection`, 'PUT', { platform: 'xiaohongshu', accountId: a.id, expectedRevision: p.revision }, owner.token)).status, 200);
  p = (await f.request('/state', 'GET', undefined, editor.token)).data.projects.find(item => item.id === p.id);
  assert.equal(p.creationSelections, undefined);
  assert.equal((await f.request(`/projects/${p.id}/creation-selection`, 'PUT', { platform: 'xiaohongshu', accountId: b.id, expectedRevision: p.revision }, editor.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, owner.token)).data.projects.find(item => item.id === p.id).creationSelections.xiaohongshu.accountId, a.id);
  assert.equal((await f.request('/editor-drafts/new', 'PUT', { brief: { ...p.brief, name: 'OWNER_PRIVATE_DRAFT' }, expectedVersion: 0 }, owner.token)).status, 200);
  assert.equal((await f.request('/editor-drafts/new', 'GET', undefined, editor.token)).data, null);
  assert.equal((await f.request('/accounts/' + a.id + '/creation-profile', 'PUT', { expectedRevision: 0, identityMarkdown: 'SHARED_ACCOUNT_IDENTITY', identityFileName: '账号.md', presets: [], defaultPresetId: '' }, owner.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, editor.token)).data.accounts.find(item => item.id === a.id).creationProfile.identityMarkdown, 'SHARED_ACCOUNT_IDENTITY');
  await f.restart(); const resumed = await f.login('owner');
  const restored = (await f.request('/state', 'GET', undefined, resumed.token)).data;
  assert.equal(restored.projects.find(item => item.id === p.id).creationSelections.xiaohongshu.accountId, a.id);
  assert.equal(restored.projectDrafts.new.brief.name, 'OWNER_PRIVATE_DRAFT');
  for (const file of readdirSync(f.directory, { recursive: true }).filter(name => /\.(sqlite|json)$/.test(name))) {
    const bytes = readFileSync(join(f.directory, file)); assert(!bytes.includes(Buffer.from('SHARED_ACCOUNT_IDENTITY')), file); assert(!bytes.includes(Buffer.from('OWNER_PRIVATE_DRAFT')), file);
  }
});

test('password reset, role changes and disabled users revoke existing sessions', async t => {
  const f = await fixture(t), owner = await f.setup(), editor = await f.add(owner, 'writer');
  assert.equal((await f.request(`/team/users/${editor.userId}`, 'PATCH', { role: 'publisher' }, owner.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, editor.token)).status, 401);
  let renewed = await f.login('writer'); assert.equal(renewed.role, 'publisher');
  assert.equal((await f.request(`/team/users/${editor.userId}`, 'PATCH', { password: 'replacement-team-password' }, owner.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, renewed.token)).status, 401);
  assert.equal((await f.request('/profiles/login', 'POST', { username: 'writer', password })).status, 401);
  renewed = (await f.request('/profiles/login', 'POST', { username: 'writer', password: 'replacement-team-password' })).data;
  assert.equal((await f.request(`/team/users/${editor.userId}`, 'PATCH', { disabled: true }, owner.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, renewed.token)).status, 401);
});

test('master key loss never silently resets an existing shared workspace', async t => {
  const f = await fixture(t); await f.setup();
  const original = join(f.directory, 'master.key'), saved = original + '.saved'; renameSync(original, saved);
  await assert.rejects(f.restart(), /缺少 master.key/);
  assert(!existsSync(original)); renameSync(saved, original);
});

test('actor context remains correct across asynchronous work, and new document jobs never cross members', async () => {
  const base = createStore(':memory:'), store = createTeamStore(base);
  const a = { userId: 'a', username: 'Alpha', role: 'admin' }, b = { userId: 'b', username: 'Beta', role: 'editor' };
  try {
    await Promise.all([runWithActor(a, async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.equal(currentActor().userId, 'a'); store.mutate(state => { state.mcpActiveAccounts = { xiaohongshu: 'a' }; state.briefImports.push({ id: 'doc-a', editorKey: 'new', status: 'ready' }); });
    }), runWithActor(b, async () => {
      await new Promise(resolve => setTimeout(resolve, 2));
      assert.equal(currentActor().userId, 'b'); store.mutate(state => { state.mcpActiveAccounts = { xiaohongshu: 'b' }; state.briefImports.push({ id: 'doc-b', editorKey: 'new', status: 'ready' }); });
    })]);
    runWithActor(a, () => { assert.equal(store.get().mcpActiveAccounts.xiaohongshu, 'a'); assert.deepEqual(store.get().briefImports.map(job => job.id), ['doc-a']); });
    runWithActor(b, () => { assert.equal(store.get().mcpActiveAccounts.xiaohongshu, 'b'); assert.deepEqual(store.get().briefImports.map(job => job.id), ['doc-b']); });
    assert.equal(currentActor(), null); assert.deepEqual(store.get().briefImports, []);
  } finally { store.close(); }
});

test('team public origin and permission guards reject ambiguous deployment or encoded bypasses', () => {
  for (const origin of ['http://192.168.1.5', 'https://user:pass@host', 'https://host/path', 'https://host/?q=1']) assert.throws(() => teamOrigin(origin));
  assert.equal(teamOrigin('http://localhost:4320').origin, 'http://localhost:4320');
  assert(teamPermission('editor', 'PUT', '/API/SETTINGS/CREDENTIAL/'));
  assert(teamPermission('editor', 'PUT', '/api/%73ettings/credential'));
  assert.equal(teamPermission('editor', 'POST', '/api/mcp/xiaohongshu/accounts/a/activate'), '');
  assert(teamPermission('editor', 'POST', '/api/projects/a/publications/b/mcp/publish'));
});

test('real Windows host key and encrypted team vault survive restart with protected directory', { skip: process.platform !== 'win32' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-team-dpapi-'));
  let storage;
  try {
    storage = await openTeamStorage({ dataDirectory: directory });
    await storage.vault('openai').save('sk-team-real-dpapi-test-only-key');
    storage.store.mutate(state => { state.projects[0].brief.name = 'TEAM_REAL_ENCRYPTED_PROJECT'; });
    storage.close(); storage = null;
    assert.equal(JSON.parse(readFileSync(join(directory, 'master.key'), 'utf8')).protection, 'dpapi-current-user');
    for (const file of readdirSync(directory, { recursive: true }).filter(name => /\.(key|json|sqlite)$/.test(name))) {
      const bytes = readFileSync(join(directory, file)); assert(!bytes.includes(Buffer.from('sk-team-real-dpapi-test-only-key'))); assert(!bytes.includes(Buffer.from('TEAM_REAL_ENCRYPTED_PROJECT')));
    }
    storage = await openTeamStorage({ dataDirectory: directory });
    assert.equal(await storage.vault('openai').getKey(), 'sk-team-real-dpapi-test-only-key');
    assert.equal(storage.store.get().projects[0].brief.name, 'TEAM_REAL_ENCRYPTED_PROJECT');
  } finally {
    storage?.close();
    if (!directory.startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
    rmSync(directory, { recursive: true });
  }
});
