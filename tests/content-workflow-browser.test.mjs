import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { indexedDB } from 'fake-indexeddb';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { createContentDraft, updateContentBrief } from '../server/content-workflow.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
globalThis.indexedDB = indexedDB;
globalThis.window = Object.assign(new EventTarget(), { indexedDB, isSecureContext: true });
Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, _options, work) => work({}) } }, configurable: true });
const compiled = await build({ stdin: { contents: "export { localAPI } from './src/local-api.ts'; export { webAPI } from './src/web-api.ts'; export { webPayload } from './src/web-payload.ts'; export { registerLocal, loginLocal, lockLocalWorkspace, readLocalState } from './src/local-vault.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { localAPI: api, webAPI, webPayload, readLocalState, registerLocal, loginLocal, lockLocalWorkspace } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const encryptedUser = name => new Promise((accept, reject) => { const open = indexedDB.open('shengzhang-local-users-v1', 2); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result, request = db.transaction('users').objectStore('users').get(name); request.onerror = () => { db.close(); reject(request.error); }; request.onsuccess = () => { db.close(); accept(request.result); }; }; });

test('browser local and web-save APIs persist scoped requirements/knowledge encrypted across unlocks without network or cross-user access', async () => {
  const originalFetch = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No external calls allowed'); };
  try {
    await registerLocal('内容工作流甲', 'content-workflow-browser-A');
    const initial = await api('/state', 'GET'), p = initial.projects[0], account = initial.accounts.find(row => row.platform === 'xiaohongshu'), path = `/projects/${p.id}`;
    const knowledge = await webAPI(path + '/knowledge', 'POST', { requestId: randomUUID(), kind: 'reference', title: '办公室资料', text: 'PRIVATE_BROWSER_REFERENCE', accountId: account.id, sourceUrl: 'https://example.com/original', sourceId: 'original-1' });
    const input = { requestId: randomUUID(), accountId: account.id, kind: 'image', requirement: 'PRIVATE_BROWSER_REQUIREMENT', knowledgeIds: [knowledge.result.id] };
    const first = await api(path + '/content-drafts', 'POST', input), again = await webAPI(path + '/content-drafts', 'POST', input); assert.equal(first.result.id, again.result.id);
    const a = first.result, changed = await webAPI(path + `/assets/${a.id}/brief`, 'PUT', { expectedRevision: 1, requirement: 'PRIVATE_BROWSER_REQUIREMENT_UPDATED', knowledgeIds: [knowledge.result.id] }); assert.equal(changed.result.revision, 2);
    await assert.rejects(api(path + `/assets/${a.id}/brief`, 'PUT', { expectedRevision: 1, requirement: 'STALE_MUST_NOT_SAVE' }), /另一处/);
    const beforePreview = (await api('/state', 'GET')).projects[0].revision, preview = await webAPI(path + '/knowledge/preview', 'POST', { assetId: a.id });
    assert.equal(preview.entries[0].id, knowledge.result.id); assert.equal((await api('/state', 'GET')).projects[0].revision, beforePreview);
    const record = await encryptedUser('内容工作流甲'); assert(record.ciphertext.byteLength > 0); assert.doesNotMatch(new TextDecoder().decode(record.ciphertext), /PRIVATE_BROWSER|content-workflow-browser-A/);
    lockLocalWorkspace(); await registerLocal('内容工作流乙', 'content-workflow-browser-B');
    const second = await api('/state', 'GET'); assert.equal(second.projects[0].knowledge?.length || 0, 0); assert.equal(second.projects[0].assets.some(row => row.id === a.id), false);
    await assert.rejects(api(`/projects/${second.projects[0].id}/knowledge/${knowledge.result.id}`, 'PATCH', { expectedRevision: 1, active: false }), /不存在/);
    lockLocalWorkspace(); await loginLocal('内容工作流甲', 'content-workflow-browser-A');
    const restored = (await api('/backup', 'GET')).projects.find(row => row.id === p.id); assert.equal(restored.assets.find(row => row.id === a.id).contentBrief.requirement, 'PRIVATE_BROWSER_REQUIREMENT_UPDATED');
    assert.equal(restored.knowledge[0].sourceUrl, 'https://example.com/original'); assert.equal(restored.assets.filter(row => row.id === a.id).length, 1); assert.equal(restored.contentRequests.filter(row => row.requestId === input.requestId).length, 1);
    assert.equal((await readLocalState()).webPrivate?.pending, undefined); assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; lockLocalWorkspace(); }
});

test('web payload rejects both direct drafts and legacy assets with added briefs before private field scrubbing', () => {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  const direct = createContentDraft(state, p, { requestId: randomUUID(), accountId: 'account-xhs', kind: 'image', requirement: 'PRIVATE_DIRECT' });
  const old = p.assets.find(row => row.channel === 'xiaohongshu' && !row.contentBrief); updateContentBrief(state, p, old.id, { expectedRevision: old.revision, requirement: 'PRIVATE_OLD_BRIEF' });
  assert.notEqual(p.strategies.find(row => row.id === old.strategyId).source, 'direct');
  for (const a of [direct, old]) for (const operation of ['copy', 'cover', 'cover-apply', 'keyframes', 'seedance']) assert.throws(() => webPayload(state, `/projects/${p.id}/assets/${a.id}/${operation}`, { expectedRevision: a.revision }, p.id), /单篇创作要求和绑定账号.*本机版或团队工作区/);
  const unrelated = webPayload(state, '/settings/credential/check', {}, p.id); assert.equal(unrelated.projects[0].knowledge, undefined); assert.equal(unrelated.projects[0].assets.length, 0);
  assert.equal(old.contentBrief.requirement, 'PRIVATE_OLD_BRIEF'); assert.equal(direct.contentBrief.requirement, 'PRIVATE_DIRECT');
});
