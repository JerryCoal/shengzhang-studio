import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createProfileApp } from '../server/profiles.mjs';
import { createStore } from '../server/store.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';

const password = 'test-only-profile-password-2026';
const apiKey = 'sk-test-profile-only-123456789012345';
async function fixture(t, { realVault = false, waitForAI } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-profiles-'));
  let app, server, base, requests = [];
  async function start() {
    app = createProfileApp({ dataDirectory: directory, staticDirectory: resolve('dist'), vaultSupported: true, transform: realVault ? undefined : async (_, value) => Buffer.from(value), workspaceOptions: { fetcher: async (url, init) => {
      requests.push({ url, key: init.headers.Authorization || init.headers.authorization });
      if (url === 'https://api.deepseek.com/chat/completions') return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: 'DeepSeek profile result', core: 'Facts only', direction: 'New plan', prompt: 'Use verified facts' }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-5.4' }] });
      if (waitForAI) await waitForAI();
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'Profile AI result', core: 'Facts only', direction: 'New plan', prompt: 'Use verified facts' }) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
    } } });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { const closed = new Promise(accept => server.close(accept)); server.closeIdleConnections(); await app.locals.close(); await closed; }
  await start();
  t.after(async () => { await stop(); if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected cleanup directory'); rmSync(directory, { recursive: true }); });
  const request = async (path, method = 'GET', body, token = '', extra = {}) => {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const hostProbe = () => new Promise((accept, reject) => { const url = new URL(base); const req = httpRequest({ hostname: url.hostname, port: url.port, path: '/api/health', headers: { Host: 'evil.example' } }, res => { res.resume(); res.on('end', () => accept(res.statusCode)); }); req.on('error', reject); req.end(); });
  return { request, hostProbe, directory, requests, restart: async () => { await stop(); await start(); }, download: path => fetch(base + path) };
}
const credentials = username => ({ username, password });

test('guide state is persisted across desktop restart and isolated by profile', async t => {
  const f = await fixture(t);
  let a = (await f.request('/profiles/register', 'POST', credentials('guide-a'))).data;
  const b = (await f.request('/profiles/register', 'POST', credentials('guide-b'))).data;
  assert.equal((await f.request('/guide', 'PUT', { action: 'start' })).status, 401);
  const started = await f.request('/guide', 'PUT', { action: 'start' }, a.token);
  assert.equal(started.status, 200); const id = started.data.result.projectId;
  assert.equal((await f.request('/guide', 'PUT', { action: 'start' }, a.token)).data.result.projectId, id);
  await f.request('/guide', 'PUT', { action: 'pause' }, a.token);
  await f.request('/guide', 'PUT', { action: 'tips', enabled: false }, a.token);
  const other = (await f.request('/state', 'GET', undefined, b.token)).data;
  assert.equal(other.guide, undefined); assert(!other.projects.some(p => p.id === id));
  await f.restart(); a = (await f.request('/profiles/login', 'POST', credentials('guide-a'))).data;
  const restored = (await f.request('/state', 'GET', undefined, a.token)).data;
  assert.equal(restored.guide.projectId, id); assert.equal(restored.guide.active, false); assert.equal(restored.guide.showTips, false);
  assert.equal(restored.projects.find(p => p.id === id).brief.budgetUsd, 0); assert.equal(f.requests.length, 0);
});

test('Seedream configuration and independent encrypted key survive profile restart without Seedance setup', async t => {
  const f = await fixture(t), key = 'seedream-profile-test-only-key';
  let a = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  const b = (await f.request('/profiles/register', 'POST', credentials('beta'))).data;
  assert.equal((await f.request('/integrations/seedream', 'PUT', { settings: defaultSeedream, apiKey: key }, a.token)).status, 200);
  await f.request('/integrations/image-provider', 'PUT', { provider: 'seedream' }, a.token);
  assert.equal((await f.request('/integrations', 'GET', undefined, b.token)).data.seedream.configured, false);
  for (const file of readdirSync(f.directory, { recursive: true }).filter(n => n.endsWith('.json'))) assert(!readFileSync(join(f.directory, file), 'utf8').includes(key));
  await f.restart(); a = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  const config = (await f.request('/integrations', 'GET', undefined, a.token)).data;
  assert.equal(config.seedream.configured, true); assert.equal(config.seedream.model, defaultSeedream.model); assert.equal(config.imageProvider, 'seedream'); assert.equal(config.seedance.configured, false);
  assert(!JSON.stringify((await f.request('/backup', 'GET', undefined, a.token)).data).includes(key));
});

test('DeepSeek keys stay encrypted and isolated by user and provider after restart', async t => {
  const f = await fixture(t), deepseekKey = 'sk-deepseek-profile-only-098765432112345';
  let alpha = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  const beta = (await f.request('/profiles/register', 'POST', credentials('beta'))).data;
  await f.request('/settings/credential', 'PUT', { apiKey }, alpha.token);
  await f.request('/settings/providers/deepseek/credential', 'PUT', { apiKey: deepseekKey }, alpha.token);
  const a = (await f.request('/settings', 'GET', undefined, alpha.token)).data;
  await f.request('/settings/models', 'PUT', { ...a.routes, strategy: 'deepseek-v4-pro' }, alpha.token);
  assert.equal((await f.request('/settings', 'GET', undefined, beta.token)).data.providers.deepseek.configured, false);
  for (const file of readdirSync(f.directory, { recursive: true }).filter(name => name.endsWith('.json'))) { const raw = readFileSync(join(f.directory, file), 'utf8'); assert.ok(!raw.includes(deepseekKey)); assert.ok(!raw.includes(apiKey)); }
  await f.restart(); alpha = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  const settings = (await f.request('/settings', 'GET', undefined, alpha.token)).data;
  assert.equal(settings.providers.deepseek.configured, true); assert.equal(settings.openaiConfigured, true);
  const p = (await f.request('/state', 'GET', undefined, alpha.token)).data.projects[0];
  const result = await f.request(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }, alpha.token);
  assert.equal(result.status, 200); assert.equal(result.data.result.source, 'deepseek');
  assert.equal(f.requests.at(-1).key, `Bearer ${deepseekKey}`);
  assert.ok(!JSON.stringify(result).includes(deepseekKey));
  await f.request('/settings/providers/deepseek/credential', 'DELETE', undefined, alpha.token);
  assert.equal((await f.request('/settings', 'GET', undefined, alpha.token)).data.openaiConfigured, true);
});

test('profile authentication isolates projects, rejects foreign origins, and revokes sessions', async t => {
  const { request, hostProbe } = await fixture(t);
  assert.equal((await request('/state')).status, 401);
  assert.equal((await request('/profiles/register', 'POST', credentials('alpha'), '', { Origin: 'https://evil.example' })).status, 403);
  assert.equal(await hostProbe(), 403);
  const alpha = (await request('/profiles/register', 'POST', credentials('Alpha'))).data;
  assert.equal(alpha.username, 'alpha'); assert.ok(alpha.token);
  assert.equal((await request('/profiles/register', 'POST', credentials('ALPHA'))).status, 409);
  assert.equal((await request('/profiles/login', 'POST', { username: 'alpha', password: 'incorrect-password' })).status, 401);
  const beta = (await request('/profiles/register', 'POST', credentials('beta'))).data;
  const original = (await request('/state', 'GET', undefined, alpha.token)).data.projects[0];
  const created = await request('/projects', 'POST', { ...original.brief, name: 'PRIVATE-BRAND-ALPHA' }, alpha.token);
  assert.equal(created.status, 201);
  const foreign = await request(`/projects/${created.data.result.id}`, 'PATCH', { brief: original.brief, expectedRevision: 1 }, beta.token);
  assert.equal(foreign.status, 404);
  assert.ok(!(await request('/state', 'GET', undefined, beta.token)).data.projects.some(p => p.brief.name === 'PRIVATE-BRAND-ALPHA'));
  assert.equal((await request('/profiles/logout', 'POST', {}, alpha.token)).status, 200);
  assert.equal((await request('/state', 'GET', undefined, alpha.token)).status, 401);
  assert.equal((await request('/state', 'GET', undefined, beta.token)).status, 200);
});

test('per-user encrypted credentials survive restart and drive the authenticated AI pipeline', async t => {
  const f = await fixture(t);
  let alpha = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  const beta = (await f.request('/profiles/register', 'POST', credentials('beta'))).data;
  const keySaved = await f.request('/settings/credential', 'PUT', { apiKey }, alpha.token); assert.equal(keySaved.status, 200);
  assert.equal((await f.request('/settings', 'GET', undefined, beta.token)).data.openaiConfigured, false);
  const p = (await f.request('/state', 'GET', undefined, alpha.token)).data.projects[0];
  const generated = await f.request(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }, alpha.token);
  assert.equal(generated.status, 200); assert.equal(generated.data.result.source, 'openai'); assert.equal(f.requests[0].key, `Bearer ${apiKey}`);
  await f.request(`/projects/${p.id}`, 'PATCH', { brief: { ...generated.data.state.projects[0].brief, name: 'PRIVATE-BRAND-ALPHA' }, expectedRevision: generated.data.state.projects[0].revision }, alpha.token);
  for (const endpoint of ['/settings', '/backup', '/state']) assert.ok(!JSON.stringify((await f.request(endpoint, 'GET', undefined, alpha.token)).data).includes(apiKey));
  await f.restart();
  assert.equal((await f.request('/state', 'GET', undefined, alpha.token)).status, 401);
  alpha = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  assert.equal((await f.request('/settings/credential/check', 'POST', {}, alpha.token)).status, 200);
  assert.equal((await f.request('/state', 'GET', undefined, alpha.token)).data.projects[0].brief.name, 'PRIVATE-BRAND-ALPHA');
  for (const file of readdirSync(f.directory, { recursive: true, withFileTypes: true }).filter(file => file.isFile())) {
    const bytes = readFileSync(join(file.parentPath, file.name));
    for (const plaintext of [apiKey, password, 'PRIVATE-BRAND-ALPHA']) assert.ok(!bytes.includes(Buffer.from(plaintext)), file.name);
  }
});

test('logging out one session preserves the other session; final logout locks download tickets', async t => {
  const f = await fixture(t);
  const a = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  const b = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  const p = (await f.request('/state', 'GET', undefined, a.token)).data.projects[0];
  const confirmed = await f.request(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`, 'POST', {}, a.token);
  const asset = confirmed.data.state.projects[0].assets.find(a => a.kind === 'image');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
  assert.equal((await f.request(`/projects/${p.id}/assets/${asset.id}`, 'PUT', { title: 'Export', body: 'Saved content', mediaData: png, mime: 'image/png', expectedRevision: asset.revision }, a.token)).status, 200);
  const exported = await f.request(`/projects/${p.id}/export`, 'POST', { kind: 'asset', id: asset.id }, a.token);
  assert.equal(exported.status, 200); assert.equal((await f.download(exported.data.url)).status, 200);
  await f.request('/profiles/logout', 'POST', {}, a.token);
  assert.equal((await f.request('/state', 'GET', undefined, b.token)).status, 200);
  await f.request('/logout', 'POST', {}, b.token);
  assert.equal((await f.download(exported.data.url)).status, 404);
});

test('encrypted workspace rejects wrong keys and scope without replacing saved data', t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-encrypted-store-'));
  t.after(() => { if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected cleanup directory'); rmSync(directory, { recursive: true }); });
  const filename = join(directory, 'workspace.sqlite'), key = randomBytes(32);
  let store = createStore(filename, { key, scope: 'alpha' }); store.mutate(state => { state.projects[0].brief.name = 'Secret brand'; }); store.close();
  store = createStore(filename, { key: randomBytes(32), scope: 'alpha' }); assert.throws(() => store.get()); store.close();
  store = createStore(filename, { key, scope: 'beta' }); assert.throws(() => store.get()); store.close();
  store = createStore(filename, { key, scope: 'alpha' }); assert.equal(store.get().projects[0].brief.name, 'Secret brand'); store.close();
});

test('logout drains an in-flight AI request before locking its encrypted workspace', async t => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, { waitForAI: async () => { entered(); await hold; } });
  const a = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  await f.request('/settings/credential', 'PUT', { apiKey }, a.token);
  const p = (await f.request('/state', 'GET', undefined, a.token)).data.projects[0];
  const generating = f.request(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }, a.token); await started;
  const loggingOut = f.request('/profiles/logout', 'POST', {}, a.token);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await f.request('/profiles/login', 'POST', credentials('alpha'))).status, 409);
  finish(); assert.equal((await generating).status, 200); assert.equal((await loggingOut).status, 200);
  const reopened = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  assert.equal((await f.request('/state', 'GET', undefined, reopened.token)).data.projects[0].strategies.at(-1).title, 'Profile AI result');
});

test('real Windows DPAPI combines with the profile password across application restarts', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { realVault: true });
  let a = (await f.request('/profiles/register', 'POST', credentials('alpha'))).data;
  assert.equal((await f.request('/settings/credential', 'PUT', { apiKey }, a.token)).status, 200);
  await f.restart();
  a = (await f.request('/profiles/login', 'POST', credentials('alpha'))).data;
  assert.equal((await f.request('/settings/credential/check', 'POST', {}, a.token)).status, 200);
  assert.equal(f.requests.at(-1).key, `Bearer ${apiKey}`);
});

test('remembered Windows login survives restart, isolates corpus and drafts, can be revoked and hides unlock keys', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { realVault: true });
  let alpha = (await f.request('/profiles/register', 'POST', { ...credentials('alpha'), remember: true })).data; assert.ok(alpha.token);
  const beta = (await f.request('/profiles/register', 'POST', credentials('beta'))).data;
  const listing = (await f.request('/profiles/remembered')).data;
  assert.equal(listing.supported, true); assert.deepEqual(listing.users.map(u => u.username), ['alpha']); const userId = listing.users[0].id;
  const p = (await f.request('/state', 'GET', undefined, alpha.token)).data.projects[0];
  await f.request(`/projects/${p.id}/corpus`, 'POST', { name: 'ALPHA-PRIVATE-CORPUS', text: 'ALPHA-PRIVATE-CORPUS-TEXT' }, alpha.token);
  await f.request('/content-rules', 'PUT', { expectedRevision: 0, rules: [{ id: 'private', term: 'ALPHA-PRIVATE-RULE', replacement: '温和', enabled: true }] }, alpha.token);
  await f.request(`/editor-drafts/${p.id}`, 'PUT', { brief: { ...p.brief, name: '', facts: 'ALPHA-PRIVATE-DRAFT' }, baseBrief: p.brief, expectedVersion: 0 }, alpha.token);
  assert.ok(!JSON.stringify((await f.request('/state', 'GET', undefined, beta.token)).data).includes('ALPHA-PRIVATE'));
  const db = new DatabaseSync(join(f.directory, 'users.sqlite'));
  const row = db.prepare('SELECT protected_key FROM remembered_users WHERE user_id=?').get(userId); db.close();
  const encrypted = Buffer.from(row.protected_key); assert.ok(!encrypted.includes(Buffer.from('"key"'))); assert.ok(!encrypted.includes(Buffer.from(password)));
  await f.restart();
  alpha = (await f.request('/profiles/quick', 'POST', { id: userId })).data; assert.ok(alpha.token);
  const recovered = (await f.request('/state', 'GET', undefined, alpha.token)).data;
  assert.equal(recovered.projectDrafts[p.id].brief.facts, 'ALPHA-PRIVATE-DRAFT'); assert.equal(recovered.projects[0].corpus[0].text, 'ALPHA-PRIVATE-CORPUS-TEXT');
  assert.equal((await f.request('/profiles/quick', 'POST', { id: userId }, '', { Origin: 'https://evil.example' })).status, 403);
  await f.request(`/profiles/remembered/${userId}`, 'DELETE');
  assert.equal((await f.request('/profiles/quick', 'POST', { id: userId })).status, 401);
  assert.equal((await f.request('/profiles/login', 'POST', credentials('alpha'))).status, 200);
  assert.deepEqual((await f.request('/profiles/remembered')).data.users, []);
  for (const file of readdirSync(f.directory, { recursive: true, withFileTypes: true }).filter(f => f.isFile())) {
    const bytes = readFileSync(join(file.parentPath, file.name));
    for (const plain of [password, 'ALPHA-PRIVATE-CORPUS', 'ALPHA-PRIVATE-DRAFT', 'ALPHA-PRIVATE-RULE']) assert.ok(!bytes.includes(Buffer.from(plain)), file.name);
  }
});

test('damaged remembered key fails closed and password login can replace it', async t => {
  const f = await fixture(t);
  await f.request('/profiles/register', 'POST', { ...credentials('alpha'), remember: true });
  const userId = (await f.request('/profiles/remembered')).data.users[0].id;
  const db = new DatabaseSync(join(f.directory, 'users.sqlite'));
  db.prepare('UPDATE remembered_users SET protected_key=? WHERE user_id=?').run(Buffer.from('{invalid'), userId); db.close();
  assert.equal((await f.request('/profiles/quick', 'POST', { id: userId })).status, 401);
  assert.equal((await f.request('/profiles/login', 'POST', { ...credentials('alpha'), remember: true })).status, 200);
  assert.equal((await f.request('/profiles/quick', 'POST', { id: userId })).status, 200);
});
