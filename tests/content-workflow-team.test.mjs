import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createTeamApp } from '../server/team-app.mjs';

test('verified team editors can create and revise scoped content/knowledge but cannot publish or act without a session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'content-workflow-team-'));
  const app = await createTeamApp({ dataDirectory: directory, publicOrigin: 'https://team.test', restrictDirectory: false, protectWithDPAPI: true, transform: async (_, value) => Buffer.from(value), workspaceOptions: { fetcher: async () => { throw new Error('No external calls in content workflow fixture'); } } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.close(); await new Promise(accept => { server.close(accept); server.closeAllConnections(); }); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup target'); rmSync(directory, { recursive: true }); });
  const req = (path, method = 'GET', body, token = '') => new Promise((accept, reject) => {
    const request = httpRequest(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Host: 'team.test', Origin: 'https://team.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.20', 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, response => {
      let content = ''; response.setEncoding('utf8'); response.on('data', chunk => { content += chunk; }); response.on('end', () => { try { accept({ status: response.statusCode, body: JSON.parse(content) }); } catch (error) { reject(error); } });
    }); request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const password = 'content-workflow-test-password';
  const setup = await req('/team/setup', 'POST', { username: 'owner', password, setupCode: readFileSync(join(directory, 'setup.code'), 'utf8') }); assert.equal(setup.status, 200); const owner = setup.body;
  assert.equal((await req('/team/users', 'POST', { username: 'writer', password, role: 'editor' }, owner.token)).status, 201);
  const login = await req('/profiles/login', 'POST', { username: 'writer', password }); assert.equal(login.status, 200); const editor = login.body;
  const snapshot = (await req('/state', 'GET', undefined, editor.token)).body, p = snapshot.projects[0], account = snapshot.accounts.find(a => a.platform === 'xiaohongshu');
  const path = `/projects/${p.id}`;
  assert.equal((await req(path + '/knowledge', 'POST', { kind: 'reference', title: '未登录', text: '不可保存' })).status, 401);
  const saved = await req(path + '/knowledge', 'POST', { requestId: randomUUID(), kind: 'experience', title: '办公场景', text: '用短句记录办公场景。', accountId: account.id }, editor.token); assert.equal(saved.status, 200); const k = saved.body.result;
  const created = await req(path + '/content-drafts', 'POST', { requestId: randomUUID(), accountId: account.id, kind: 'image', requirement: '办公场景图文', knowledgeIds: [k.id] }, editor.token); assert.equal(created.status, 200); const a = created.body.result;
  assert.equal((await req(path + `/assets/${a.id}/brief`, 'PUT', { expectedRevision: 1, requirement: '自然风格办公场景', knowledgeIds: [k.id] }, editor.token)).status, 200);
  assert.equal((await req(path + `/knowledge/${k.id}`, 'PATCH', { expectedRevision: 1, active: false }, editor.token)).status, 200);
  assert.equal((await req(path + '/publications', 'POST', { assetId: a.id, accountId: account.id, scheduledAt: new Date(Date.now() + 60000).toISOString() }, editor.token)).status, 403);
  assert.equal((await req('/settings/models', 'PUT', {}, editor.token)).status, 403);
  const shared = (await req('/state', 'GET', undefined, owner.token)).body.projects.find(row => row.id === p.id);
  assert.equal(shared.assets.find(row => row.id === a.id).contentBrief.accountId, account.id); assert.equal(shared.knowledge.find(row => row.id === k.id).active, false);
});
