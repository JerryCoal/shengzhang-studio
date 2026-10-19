import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createActiveJobs } from '../server/active-jobs.mjs';
import { saveTaskJournal, taskJournal, removeTaskJournal } from '../server/task-journal.mjs';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { createApp } from '../server/app.mjs';
import { confirmStrategy } from '../server/domain.mjs';

test('scoped tasks allow independent work and preserve whole-project safety guards', () => {
  const jobs = createActiveJobs(), a = jobs.acquire('p', 'asset:a'), b = jobs.acquire('p', 'asset:b');
  assert(a && b); assert.equal(jobs.size, 2); assert.equal(jobs.has('p'), true);
  assert.equal(jobs.acquire('p', 'asset:a'), null);
  assert.equal(jobs.release('p', 'asset:a', b), false, 'another task cannot release this lock');
  jobs.release('p', 'asset:a', a); assert.equal(jobs.has('p'), true);
  jobs.release('p', 'asset:b', b); assert.equal(jobs.has('p'), false);
  jobs.add('p'); assert.equal(jobs.canAcquire('p', 'asset:a'), false); jobs.delete('p');
  assert.equal(jobs.size, 0);
});

const draft = (projectId, id = 'task-one') => ({ id, workspaceKey: `studio:${projectId}`, projectId, projectName: '私有项目', page: 'studio', accountId: 'account-a', label: '生成图文', status: 'paused', retained: true, startedAt: 1, updatedAt: 2, stage: '文案已保存，等待制作素材', target: { assetId: 'asset-a', accountId: 'account-a', requirement: 'PRIVATE_REQUIREMENT' }, checkpoint: { draft: 'PRIVATE_PARTIAL_CONTENT' } });
test('journal preserves private progress and rejects identity changes and oversize snapshots', () => {
  const state = { projects: [{ id: 'p' }] }, task = draft('p');
  saveTaskJournal(state, task.id, task);
  assert.deepEqual(taskJournal(state), [task]);
  assert.throws(() => saveTaskJournal(state, task.id, { ...task, accountId: 'account-b' }), /归属/);
  assert.throws(() => saveTaskJournal(state, task.id, { ...task, checkpoint: 'x'.repeat(150001) }), /过大/);
  assert.throws(() => removeTaskJournal(state, task.id), /完成/);
  saveTaskJournal(state, task.id, { ...task, status: 'interrupted' });
  removeTaskJournal(state, task.id); assert.deepEqual(taskJournal(state), []);
});

test('team journal is projected per member and encrypted at the store boundary', () => {
  const base = createStore(':memory:', { key: Buffer.alloc(32, 7), scope: 'test-workspace' }), store = createTeamStore(base), pid = base.get().projects[0].id;
  const alice = { userId: 'alice' }, bob = { userId: 'bob' };
  try {
    runWithActor(alice, () => store.mutate(state => saveTaskJournal(state, 'task-one', draft(pid))));
    assert.equal(runWithActor(alice, () => taskJournal(store.get()))[0].checkpoint.draft, 'PRIVATE_PARTIAL_CONTENT');
    assert.deepEqual(runWithActor(bob, () => taskJournal(store.get())), []);
    runWithActor(bob, () => store.mutate(state => saveTaskJournal(state, 'task-one', { ...draft(pid), accountId: 'account-b' })));
    assert.equal(runWithActor(alice, () => taskJournal(store.get()))[0].accountId, 'account-a');
    assert.equal(runWithActor(bob, () => taskJournal(store.get()))[0].accountId, 'account-b');
    assert.equal(runWithActor(alice, () => store.get()).teamPreferences, undefined);
  } finally { base.close(); }
});

async function fixture(t) {
  const store = createStore(':memory:'), entered = [], releases = [];
  store.mutate(state => { const project = state.projects[0]; confirmStrategy(project, project.strategies[0].id); project.brief.budgetUsd = 100; state.contentRules = []; });
  const app = createApp(store, { apiKey: 'mock-only-no-network', fetcher: async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).input); entered.push(input);
    await new Promise(resolve => { releases.push(resolve); });
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: `完成-${input.task.channel}`, body: '基于项目事实描述日常使用场景。', prompt: '自然光场景', scenes: ['开场', '演示', '总结'] }) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { releases.forEach(release => release()); await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (asset, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${store.get().projects[0].id}/assets/${asset.id}/copy`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ expectedRevision: asset.revision, ...body }) });
    return { status: response.status, data: await response.json() };
  };
  return { store, entered, releases, req, app };
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Mock request was not dispatched'); }

test('same-project different assets execute concurrently; duplicate content never dispatches twice', { timeout: 10000 }, async t => {
  const f = await fixture(t), [a, b] = f.store.get().projects[0].assets;
  assert(a && b);
  const first = f.req(a); await until(() => f.entered.length === 1);
  const duplicate = await f.req(a); assert.equal(duplicate.status, 409); assert.equal(f.entered.length, 1);
  const second = f.req(b); await until(() => f.entered.length === 2);
  assert.equal(f.store.get().projects[0].usage.filter(row => row.status === 'running').length, 2);
  f.releases[1](); assert.equal((await second).status, 200);
  assert.equal(f.app.locals.activeJobs.has(f.store.get().projects[0].id), true, 'finishing second job cannot release first');
  f.releases[0](); assert.equal((await first).status, 200);
  const current = f.store.get().projects[0];
  assert.equal(current.usage.filter(row => row.status === 'completed').length, 2);
  assert.equal(current.assets.find(item => item.id === a.id).title, `完成-${a.channel}`);
  assert.equal(current.assets.find(item => item.id === b.id).title, `完成-${b.channel}`);
  assert.equal(f.app.locals.activeJobs.size, 0);
});

test('concurrent reservations remain budget guarded and stale edits are not overwritten', { timeout: 10000 }, async t => {
  const f = await fixture(t), [a, b] = f.store.get().projects[0].assets;
  const first = f.req(a); await until(() => f.entered.length === 1);
  f.store.mutate(state => { const project = state.projects[0]; project.brief.budgetUsd = project.usage.reduce((sum, row) => sum + row.amountUsd, 0); const asset = project.assets.find(item => item.id === a.id); asset.title = '用户人工更改'; asset.revision++; });
  const second = await f.req(b); assert.equal(second.status, 400); assert.match(second.data.error, /预算|余额/);
  assert.equal(f.entered.length, 1);
  f.releases[0](); assert.equal((await first).status, 409);
  assert.equal(f.store.get().projects[0].assets.find(item => item.id === a.id).title, '用户人工更改');
  assert.equal(f.app.locals.activeJobs.size, 0);
});
