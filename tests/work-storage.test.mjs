import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createStore } from '../server/store.mjs';

function diskFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-work-storage-'));
  const filename = join(directory, 'synthetic.sqlite'), key = Buffer.alloc(32, 173), opened = [];
  const open = (options = {}) => { const store = createStore(filename, { key, scope: 'synthetic-work-owner', ...options }); opened.push(store); return store; };
  t.after(() => { for (const store of opened) { try { store.close(); } catch { /* already closed */ } } assert(directory.startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true }); });
  return { directory, filename, key, open };
}

test('work storage encrypts record and event bodies, survives reopen, and rejects a different key or scope', t => {
  const f = diskFixture(t); let store = f.open();
  const record = { id: 'run-one', ownerId: 'member-one', body: 'PRIVATE_WORK_BODY_9F8C', snapshot: { goal: 'PRIVATE_SNAPSHOT_6A2E' } };
  store.work.put('run', record);
  store.work.append({ id: 'event-one', runId: record.id, detail: 'PRIVATE_EVENT_BODY_4D1B' });
  store.close();
  for (const file of readdirSync(f.directory)) {
    const bytes = readFileSync(join(f.directory, file));
    for (const secret of [record.body, record.snapshot.goal, 'PRIVATE_EVENT_BODY_4D1B']) assert(!bytes.includes(Buffer.from(secret)), `${file} exposed a work body`);
  }
  store = f.open(); assert.deepEqual(store.work.get('run', record.id), record);
  assert.equal(store.work.events(record.id)[0].detail, 'PRIVATE_EVENT_BODY_4D1B'); store.close();
  for (const options of [{ key: Buffer.alloc(32, 174) }, { scope: 'different-owner' }]) {
    const wrong = f.open(options); assert.throws(() => wrong.work.get('run', record.id)); assert.throws(() => wrong.work.events(record.id)); wrong.close();
  }
});

test('work completion transaction atomically rolls back artifacts, run, outbox, events and legacy mutation', t => {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 14) }); t.after(() => store.close());
  const before = store.get(), counts = store.work.counts();
  assert.throws(() => store.work.transaction(() => {
    store.mutate(state => { state.projects[0].brief.name = 'SHOULD_NOT_COMMIT'; });
    for (const kind of ['artifact', 'run', 'notification']) store.work.put(kind, { id: 'atomic-one', ownerId: 'user-one', body: kind });
    store.work.append({ id: 'atomic-event', runId: 'atomic-one', summary: 'SHOULD_NOT_COMMIT' });
    throw new Error('synthetic-save-fault');
  }), /synthetic-save-fault/);
  assert.deepEqual(store.get(), before); assert.deepEqual(store.work.counts(), counts);
  for (const kind of ['artifact', 'run', 'notification']) assert.equal(store.work.get(kind, 'atomic-one'), null);
  assert.equal(store.work.cursor('atomic-one'), 0);
  store.work.transaction(() => {
    store.mutate(state => { state.projects[0].brief.name = 'COMMITTED_TOGETHER'; });
    store.work.put('artifact', { id: 'atomic-one', ownerId: 'user-one' });
    store.work.append({ id: 'atomic-event', runId: 'atomic-one' });
  });
  assert.equal(store.get().projects[0].brief.name, 'COMMITTED_TOGETHER'); assert.equal(store.work.cursor('atomic-one'), 1);
});

test('an activity append does not rewrite the encrypted legacy workspace blob', t => {
  const f = diskFixture(t), store = f.open(), inspection = new DatabaseSync(f.filename, { readOnly: true });
  const before = inspection.prepare('SELECT body FROM workspace WHERE id=1').get().body;
  for (let i = 0; i < 12; i++) store.work.append({ id: `separate-${i}`, runId: 'independent-events', summary: `activity ${i}` });
  const after = inspection.prepare('SELECT body FROM workspace WHERE id=1').get().body;
  inspection.close(); assert.equal(after, before); assert.equal(store.work.cursor('independent-events'), 12);
});

test('event paging and explicit archive preserve monotonic per-run sequences and independent runs', t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  for (let i = 1; i <= 5; i++) assert.equal(store.work.append({ id: `r1-${i}`, runId: 'r1', at: i % 2 ? '2020-01-01' : '2010-01-01' }).sequence, i);
  assert.equal(store.work.append({ id: 'r2-1', runId: 'r2' }).sequence, 1);
  assert.deepEqual(store.work.events('r1', 2, 2).map(e => e.sequence), [3, 4]);
  assert.throws(() => store.work.append({ id: 'r1-1', runId: 'r1' })); assert.equal(store.work.cursor('r1'), 5);
  const archived = store.work.archiveEvents('r1', 3); assert.equal(archived.through, 3); assert.deepEqual(archived.chunks[0].map(e => e.sequence), [1, 2, 3]);
  assert.deepEqual(store.work.events('r1').map(e => e.sequence), [4, 5]);
  store.work.archiveEvents('r1', 5); assert.equal(store.work.events('r1').length, 0); assert.equal(store.work.cursor('r1'), 5);
  assert.equal(store.work.append({ id: 'r1-6', runId: 'r1' }).sequence, 6); assert.equal(store.work.cursor('r2'), 1);
});

test('asynchronous work transactions are rejected without retaining partial synchronous writes', t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  assert.throws(() => store.work.transaction(async () => { store.work.put('run', { id: 'bad-async', ownerId: 'owner' }); }), /同步/);
  assert.equal(store.work.get('run', 'bad-async'), null);
});
