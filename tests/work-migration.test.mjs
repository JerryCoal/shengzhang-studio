import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createStore } from '../server/store.mjs';
import { createWorkControl } from '../server/work-control.mjs';
import { createWorkBackup, validateWorkBackup } from '../server/work-backup.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { seedState } from '../server/domain.mjs';

const actor = { userId: 'backup-owner-a', username: 'Backup A', role: 'editor' }, other = { userId: 'backup-owner-b', username: 'Backup B', role: 'editor' };
const as = work => runWithActor(actor, work);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const rehash = input => { const { sha256: old, ...body } = input; return { ...body, sha256: createHash('sha256').update(canonical(body)).digest('hex') }; };
function memory(t, empty = false) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 33), scope: 'synthetic-migration' });
  if (empty) store.mutate(state => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, { schemaVersion: 1, projects: [], accounts: [], activities: [] }); });
  t.after(() => store.close()); return store;
}
function history(state) {
  const project = state.projects[0];
  project.assets = [{ id: 'historic-asset', strategyId: project.strategies[0].id, title: '原作品', body: '原正文', revision: 7, contentBrief: { accountId: 'account-xhs' } }];
  project.publications = [{ id: 'historic-publication', assetId: 'historic-asset', accountId: 'account-xhs', status: 'published', platformPostId: 'original-post-id' }];
  project.usage = [{ id: 'unknown-fee-original', status: 'uncertain', amountUsd: 2.75, estimated: true, note: '未知费用，不能释放' }, { id: 'running-fee-original', status: 'running', amountUsd: 0.5, estimated: true }];
  state.agentWorkspace = { [`${project.id}:xiaohongshu`]: { requirement: '旧草稿原文', accountId: 'account-xhs' } };
  state.taskJournal = Array.from({ length: 40 }, (_, index) => ({ id: `historic-finished-${index}`, workspaceKey: 'old', projectId: project.id, projectName: project.brief.name, page: 'agent-xiaohongshu', accountId: 'account-xhs', label: `已有历史 ${index}`, status: index % 2 ? 'completed' : 'failed', retained: true, startedAt: 1700000000000 + index, updatedAt: 1700000000000 + index, finishedAt: 1700000000000 + index }));
  for (const status of ['running', 'pausing', 'paused', 'interrupted']) state.taskJournal.push({ ...state.taskJournal[0], id: `historic-${status}`, label: `未完成 ${status}`, status });
  return state;
}
function controller(store) {
  let calls = 0;
  const control = createWorkControl({ store, autoStart: false, config: { workOwnerId: actor.userId }, executors: { prepare: ({ node }) => ({ ...node, modelRoute: { provider: 'fake', model: 'fake' }, permissions: ['model:copy'], estimateUSD: 0 }), execute: async () => { calls++; throw new Error('Migration must never dispatch'); } } });
  return { control, get calls() { return calls; } };
}
async function approvedRecords(store, runtime) {
  const projectId = store.get().projects[0].id;
  const plan = as(() => runtime.control.createPlan(projectId, { goal: '备份合成计划', nodes: [{ id: 'backup-task', title: '备份合成任务', role: 'xiaohongshu-copy', accountId: 'account-xhs', requirement: '合成不执行', dependsOn: [], budgetUSD: 0 }], idempotencyKey: 'migration-plan-create' }).plan);
  return as(() => runtime.control.approvePlan(plan.id, { version: 1, budgetUSD: 0, idempotencyKey: 'migration-plan-approve' }));
}

test('a genuine legacy SQLite blob migrates exactly its 40 retained terminal checkpoints and never synthesizes older history', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-old-work-migration-')), filename = join(directory, 'legacy.sqlite');
  t.after(() => { assert(directory.startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true }); });
  const original = history(seedState()), old = new DatabaseSync(filename); old.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)'); old.prepare('INSERT INTO workspace VALUES(1,?)').run(JSON.stringify(original)); old.close();
  const store = createStore(filename), runtime = controller(store);
  try {
    const before = store.get(); as(() => runtime.control.migrateLegacy()); as(() => runtime.control.migrateLegacy()); await runtime.control.tick();
    const tasks = store.work.all('task', actor.userId), runs = store.work.all('run', actor.userId);
    assert.equal(tasks.length, 44); assert.equal(runs.length, 44); assert.equal(runs.filter(run => /historic-finished-/.test(run.id)).length, 40);
    for (const run of runs) assert.equal(run.source, 'legacy-checkpoint');
    for (const status of ['running', 'pausing', 'paused', 'interrupted']) assert.equal(runs.find(run => run.id.includes(`historic-${status}:`)).status, 'needs_reconciliation');
    assert.deepEqual(store.get(), before); assert.equal(runtime.calls, 0);
    assert.equal(store.get().projects[0].assets[0].id, 'historic-asset'); assert.equal(store.get().projects[0].publications[0].id, 'historic-publication'); assert.deepEqual(store.get().projects[0].usage, original.projects[0].usage);
    assert.equal(store.work.all('migration', actor.userId).length, 1);
  } finally { await runtime.control.close(); store.close(); }
});

test('legacy migration failure rolls back all new records and can retry without duplicated snapshots or budget changes', async t => {
  const store = memory(t); store.mutate(history); const runtime = controller(store), before = store.get(), put = store.work.put.bind(store.work); let count = 0;
  store.work.put = (kind, value) => { if (kind === 'task' && ++count === 8) throw new Error('synthetic-mid-migration-fault'); return put(kind, value); };
  assert.throws(() => as(() => runtime.control.migrateLegacy()), /synthetic-mid-migration-fault/);
  assert.deepEqual(store.work.counts(), { records: 0, events: 0 }); assert.deepEqual(store.get(), before);
  store.work.put = put; as(() => runtime.control.migrateLegacy()); assert.equal(store.work.all('task', actor.userId).length, 44); assert.equal(store.work.all('run', actor.userId).length, 44); assert.deepEqual(store.get(), before); assert.equal(runtime.calls, 0);
  await runtime.control.close();
});

test('owner backup excludes other personal histories and credentials while retaining authorized shared content', t => {
  const store = memory(t); store.mutate(state => {
    state.teamPreferences = { [actor.userId]: { agentWorkspace: { mine: { text: 'MY_PRIVATE_DRAFT' } }, taskJournal: [] }, [other.userId]: { agentWorkspace: { other: { text: 'OTHER_MEMBER_PRIVATE_DRAFT' } }, taskJournal: [] } };
    state.accounts[0].apiKey = 'SYNTHETIC_API_KEY_PRIVATE'; state.connection = { authorization: 'Bearer SYNTHETIC_PRIVATE_TOKEN', endpoint: 'https://service.test?token=SYNTHETIC_QUERY_PRIVATE' };
  });
  store.work.put('message', { id: 'foreign-only', ownerId: other.userId, taskId: 'foreign-task', runId: 'foreign-run', text: 'OTHER_MEMBER_PRIVATE_MESSAGE' });
  const service = createWorkBackup(store), exported = as(() => service.exportForOwner(actor.userId)), text = JSON.stringify(exported);
  assert(text.includes('MY_PRIVATE_DRAFT')); for (const secret of ['OTHER_MEMBER_PRIVATE_DRAFT', 'OTHER_MEMBER_PRIVATE_MESSAGE', 'SYNTHETIC_API_KEY_PRIVATE', 'SYNTHETIC_PRIVATE_TOKEN', 'SYNTHETIC_QUERY_PRIVATE']) assert(!text.includes(secret), secret);
  assert(exported.redactions.length >= 3); assert.equal(service.validate(exported).ownerId, actor.userId);
  assert.throws(() => runWithActor(other, () => service.exportForOwner(actor.userId)), error => error.status === 403);
  assert.throws(() => service.exportForOwner(actor.userId), error => error.status === 403);
});

test('portable backup restores into a distinct empty store with original IDs, archived sequences and unchanged unknown charges', async t => {
  const source = memory(t); source.mutate(history); const runtime = controller(source); as(() => runtime.control.migrateLegacy()); const approved = await approvedRecords(source, runtime), run = source.work.get('run', approved.runs[0].id);
  run.status = 'running'; run.sent = true; run.lease = { token: 'old-fence', workerId: 'old-worker', expiresAt: Date.now() + 50000 }; run.attempts = [{ id: 'attempt-original', sentAt: '2026-10-20T00:00:00Z', externalRequestId: 'original-external-id' }]; source.work.put('run', run);
  for (let index = 0; index < 5; index++) source.work.append({ id: `migrate-event-${index}`, runId: run.id, taskId: run.taskId, type: 'synthetic.fact', summary: `原活动${index}` });
  source.work.archiveEvents(run.id, 3);
  const sourceState = source.get(), sourceEvents = source.work.events(run.id), service = createWorkBackup(source), backup = as(() => service.exportForOwner(actor.userId));
  const target = memory(t, true), imported = as(() => createWorkBackup(target).importIntoEmptyStore(backup, { ownerId: actor.userId }));
  assert(imported.executionDisabled); assert.equal(imported.counts.legacyCheckpoints, 44); assert.deepEqual(target.get(), sourceState);
  assert.deepEqual(target.work.events(run.id), sourceEvents); assert.deepEqual(target.work.get('archive', run.id), source.work.get('archive', run.id));
  const restored = target.work.get('run', run.id); assert.equal(restored.status, 'needs_reconciliation'); assert.equal(restored.source, 'legacy-checkpoint'); assert.equal(restored.lease, undefined); assert.equal(restored.approval, undefined); assert.equal(restored.restoredApproval.version, 1); assert.equal(restored.attempts[0].externalRequestId, 'original-external-id');
  assert.equal(target.work.all('command').length, 0); assert.equal(target.work.all('backup-command').length, 2); assert.equal(target.work.get('plan', approved.plan.id).versions[0].status, 'restored');
  assert.deepEqual(target.get().projects[0].usage, sourceState.projects[0].usage); assert.equal(source.work.get('run', run.id).status, 'running');
  const reopened = controller(target); reopened.control.recover(); await reopened.control.tick(); assert.equal(reopened.calls, 0); assert.equal(target.work.get('run', run.id).status, 'needs_reconciliation');
  const next = target.work.append({ id: 'post-restore-event', runId: run.id, taskId: run.taskId, type: 'synthetic.fact' }); assert.equal(next.sequence, 7);
  assert.throws(() => as(() => createWorkBackup(target).importIntoEmptyStore(backup, { ownerId: actor.userId })), error => error.status === 409);
  const reexported = as(() => createWorkBackup(target).exportForOwner(actor.userId)); assert.equal(validateWorkBackup(reexported).counts.allEvents, validateWorkBackup(backup).counts.allEvents + 1);
  await runtime.control.close(); await reopened.control.close();
});

test('restore rejects occupied targets, foreign owners, tampering and event gaps before changing anything', async t => {
  const source = memory(t), runtime = controller(source); const approved = await approvedRecords(source, runtime), backup = as(() => createWorkBackup(source).exportForOwner(actor.userId));
  const occupied = memory(t), before = occupied.get(); assert.throws(() => as(() => createWorkBackup(occupied).importIntoEmptyStore(backup, { ownerId: actor.userId })), error => error.status === 409); assert.deepEqual(occupied.get(), before);
  const target = memory(t, true), empty = target.get();
  const corrupt = clone(backup); corrupt.workspace.projects[0].brief.name = 'tampered'; assert.throws(() => as(() => createWorkBackup(target).importIntoEmptyStore(corrupt, { ownerId: actor.userId })), /校验值/);
  const foreign = clone(backup); foreign.records.find(row => row.kind === 'run').value.ownerId = other.userId; assert.throws(() => validateWorkBackup(rehash(foreign)), /其他成员/);
  const gap = clone(backup); gap.events[0].sequence = 99; assert.throws(() => validateWorkBackup(rehash(gap)), /连续序列/);
  const missing = clone(backup); missing.records = missing.records.filter(row => !(row.kind === 'task' && row.value.id === approved.tasks[0].id)); assert.throws(() => validateWorkBackup(rehash(missing)), /任务关系/);
  assert.throws(() => runWithActor(other, () => createWorkBackup(target).importIntoEmptyStore(backup, { ownerId: other.userId })), error => error.status === 403);
  assert.deepEqual(target.get(), empty); assert.deepEqual(target.work.counts(), { records: 0, events: 0 }); await runtime.control.close();
});

test('restore transaction failure leaves the independent target empty and a retry imports each record exactly once', async t => {
  const source = memory(t); source.mutate(history); const runtime = controller(source); as(() => runtime.control.migrateLegacy()); const backup = as(() => createWorkBackup(source).exportForOwner(actor.userId)), target = memory(t, true), before = target.get(), put = target.work.put.bind(target.work); let count = 0;
  target.work.put = (kind, value) => { if (++count === 7) throw new Error('synthetic-restore-write-fault'); return put(kind, value); };
  assert.throws(() => as(() => createWorkBackup(target).importIntoEmptyStore(backup, { ownerId: actor.userId })), /synthetic-restore-write-fault/); assert.deepEqual(target.get(), before); assert.deepEqual(target.work.counts(), { records: 0, events: 0 });
  target.work.put = put; as(() => createWorkBackup(target).importIntoEmptyStore(backup, { ownerId: actor.userId })); assert.equal(target.work.all('task', actor.userId).length, 44); assert.equal(target.work.all('run', actor.userId).length, 44); assert.equal(target.work.all('backup-restore', actor.userId).length, 1); assert.equal(runtime.calls, 0);
  await runtime.control.close();
});

test('restored pending work stays paused rather than queued and raw full database rollback remains separate', async t => {
  const source = memory(t), runtime = controller(source), approved = await approvedRecords(source, runtime), backup = as(() => createWorkBackup(source).exportForOwner(actor.userId)), target = memory(t, true);
  as(() => createWorkBackup(target).importIntoEmptyStore(JSON.stringify(backup), { ownerId: actor.userId }));
  assert.equal(target.work.get('run', approved.runs[0].id).status, 'paused'); assert.equal(target.work.get('task', approved.tasks[0].id).status, 'paused');
  const replay = controller(target); replay.control.recover(); await replay.control.tick(); assert.equal(replay.calls, 0);
  assert(backup.warnings.some(note => note.includes('旧程序不能写新版数据库'))); assert(backup.warnings.some(note => note.includes('不是加密文件')));
  await runtime.control.close(); await replay.control.close();
});

test('repeated restore preserves old and newly reused command keys as distinct historical evidence', async t => {
  const source = memory(t), runtime = controller(source); await approvedRecords(source, runtime);
  const firstBackup = as(() => createWorkBackup(source).exportForOwner(actor.userId)), firstTarget = memory(t, true);
  as(() => createWorkBackup(firstTarget).importIntoEmptyStore(firstBackup, { ownerId: actor.userId }));
  const originalCommand = source.work.all('command', actor.userId)[0];
  firstTarget.work.put('command', { ...originalCommand, result: { newExecutionEvidence: 'new-command-same-client-key' } });
  const secondBackup = as(() => createWorkBackup(firstTarget).exportForOwner(actor.userId)), secondTarget = memory(t, true);
  as(() => createWorkBackup(secondTarget).importIntoEmptyStore(secondBackup, { ownerId: actor.userId }));
  const preserved = secondTarget.work.all('backup-command', actor.userId); assert.equal(preserved.length, 3); assert.equal(new Set(preserved.map(row => row.id)).size, 3);
  assert.equal(preserved.filter(row => row.originalId === originalCommand.id).length, 2); assert(preserved.some(row => row.result.newExecutionEvidence === 'new-command-same-client-key'));
  await runtime.control.close();
});

const clone = value => structuredClone(value);
