import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentEditDraftKey, readContentEditDraft, saveContentEditDraft, removeContentEditDraft } from '../server/content-edit-drafts.mjs';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { createApp } from '../server/app.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { assetAccountId } from '../server/workspace-view.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';

function input(state) {
  const p = state.projects[0], a = p.assets[0], accountId = assetAccountId(a);
  const fields = { title: a.title, body: a.body, requirement: a.contentBrief?.requirement || '', knowledgeIds: a.contentBrief?.knowledgeIds || [] };
  return { key: contentEditDraftKey(p.id, a.id, accountId), draft: { projectId: p.id, assetId: a.id, accountId, base: { ...fields, revision: a.revision }, ...fields, title: 'PRIVATE_TITLE', body: 'PRIVATE_UNFINISHED_BODY', requirement: 'PRIVATE_REQUIREMENT' } };
}
const prepare = store => store.mutate(state => confirmStrategy(state.projects[0], state.projects[0].strategies[0].id));
test('temporary content edits restore across encrypted restart and never overwrite a newer asset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-content-edit-')), filename = join(directory, 'workspace.sqlite');
  const options = { key: Buffer.alloc(32, 13), scope: 'edit-restart-test' }; let store = createStore(filename, options);
  try {
    prepare(store);
    const { key, draft } = input(store.get());
    const first = store.mutate(state => saveContentEditDraft(state, key, { expectedRevision: null, draft }));
    store.mutate(state => { const a = state.projects[0].assets[0]; a.title = 'NEWER_SHARED_ASSET'; a.revision++; });
    store.close(); store = null;
    assert(!readFileSync(filename).includes(Buffer.from('PRIVATE_UNFINISHED_BODY')));
    store = createStore(filename, options);
    assert.deepEqual(readContentEditDraft(store.get(), key), first);
    assert.equal(store.get().projects[0].assets[0].title, 'NEWER_SHARED_ASSET');
    const second = store.mutate(state => saveContentEditDraft(state, key, { expectedRevision: first.revision, draft: { ...draft, body: 'PRIVATE_MORE_EDITING' } }));
    assert.equal(second.base.revision, draft.base.revision); assert.equal(store.get().projects[0].assets[0].title, 'NEWER_SHARED_ASSET');
    assert.throws(() => store.mutate(state => removeContentEditDraft(state, key, { expectedRevision: first.revision })), /另一窗口/);
    store.mutate(state => removeContentEditDraft(state, key, { expectedRevision: second.revision }));
    assert.equal(readContentEditDraft(store.get(), key), null);
  } finally { store?.close(); rmSync(directory, { recursive: true }); }
});
test('temporary edits are per member, frozen-account scoped and CAS protected', () => {
  const base = createStore(':memory:', { key: Buffer.alloc(32, 14) }), team = createTeamStore(base);
  try {
    prepare(base);
    base.mutate(state => { state.projects[0].assets[0].contentBrief = { accountId: 'bound-account' }; });
    const { key, draft } = input(base.get()), alice = { userId: 'alice' }, bob = { userId: 'bob' };
    const a = runWithActor(alice, () => team.mutate(state => saveContentEditDraft(state, key, { expectedRevision: null, draft })));
    assert.equal(runWithActor(bob, () => readContentEditDraft(team.get(), key)), null);
    runWithActor(bob, () => team.mutate(state => saveContentEditDraft(state, key, { expectedRevision: null, draft: { ...draft, body: 'BOB_PRIVATE' } })));
    assert.equal(runWithActor(alice, () => readContentEditDraft(team.get(), key)).body, 'PRIVATE_UNFINISHED_BODY');
    assert.throws(() => runWithActor(alice, () => team.mutate(state => saveContentEditDraft(state, key, { expectedRevision: null, draft }))), /另一窗口/);
    assert.throws(() => runWithActor(alice, () => team.mutate(state => saveContentEditDraft(state, contentEditDraftKey(draft.projectId, draft.assetId, 'other-account'), { expectedRevision: null, draft: { ...draft, accountId: 'other-account' } }))), /绑定账号/);
    runWithActor(alice, () => team.mutate(state => removeContentEditDraft(state, key, { expectedRevision: a.revision })));
    assert.equal(runWithActor(bob, () => readContentEditDraft(team.get(), key)).body, 'BOB_PRIVATE');
  } finally { base.close(); }
});
test('temporary edits never enter a web relay snapshot or accept remote overwrite', () => {
  const store = createStore(':memory:');
  try {
    prepare(store);
    const current = store.get(), { key, draft } = input(current); saveContentEditDraft(current, key, { expectedRevision: null, draft });
    const base = structuredClone(current); removeWebSkillHistory(base); assert(!JSON.stringify(base).includes('PRIVATE_UNFINISHED_BODY'));
    const remote = structuredClone(base); remote.contentEditDrafts = [{ body: 'INJECTED_EDIT' }]; remote.projects[0].contentEditDrafts = [{ body: 'INJECTED_EDIT' }];
    const merged = mergeRelayState(base, remote, current);
    assert.deepEqual(merged.contentEditDrafts, current.contentEditDrafts); assert(!JSON.stringify(merged).includes('INJECTED_EDIT'));
  } finally { store.close(); }
});
test('content-edit HTTP routes save, conflict and delete without invoking any provider', async t => {
  const store = createStore(':memory:'); let externalCalls = 0;
  prepare(store);
  const app = createApp(store, { fetcher: async () => { externalCalls++; throw new Error('External network forbidden'); } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const { key, draft } = input(store.get()), path = `http://127.0.0.1:${server.address().port}/api/content-edit-drafts/${encodeURIComponent(key)}`;
  const request = async (method = 'GET', body) => { const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() }; };
  assert.equal((await request()).data, null);
  const saved = await request('PUT', { expectedRevision: null, draft }); assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal((await request('PUT', { expectedRevision: null, draft })).status, 409);
  assert.equal((await request()).data.body, draft.body);
  assert.equal((await request('DELETE', { expectedRevision: saved.data.revision })).status, 200);
  assert.equal((await request()).data, null); assert.equal(externalCalls, 0);
});
