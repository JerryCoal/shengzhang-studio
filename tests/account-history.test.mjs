import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { indexedDB } from 'fake-indexeddb';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { publicationAccountChoice } from '../server/publish-readiness.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const trace = accountId => ({ accounts: [{ accountId, accountName: accountId, platform: 'xiaohongshu', identityMarkdown: `${accountId} 的身份`, profileRevision: 1, presetId: '', presetName: '', topic: '', instruction: '' }] });
async function exercise({ mutate, api, read }) {
  await mutate(state => {
    const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
    const a = p.assets.find(asset => asset.kind === 'image');
    Object.assign(a, { status: 'ready', title: '待替换标题', mediaData: png, mime: 'image/png', creationTrace: trace('source-A') });
    state.contentRules = [{ id: 'word', term: '待替换', replacement: '已核对', enabled: true }];
  });
  const original = (await read()).projects[0], asset = original.assets.find(a => a.kind === 'image');
  const path = `/projects/${original.id}/assets/${asset.id}`;
  const reviewed = await api(`${path}/review`, 'POST', { expectedRevision: asset.revision });
  assert.deepEqual(reviewed.result.history[0].creationTrace, trace('source-A'));
  await mutate(state => { const a = state.projects[0].assets.find(a => a.id === asset.id); a.creationTrace = trace('new-B'); state.contentRules = []; });
  const restored = await api(`${path}/restore`, 'POST', { revision: asset.revision });
  assert.deepEqual(restored.result.creationTrace, trace('source-A'));
  assert.equal(publicationAccountChoice(restored.result, [{ id: 'source-A', platform: 'xiaohongshu' }, { id: 'new-B', platform: 'xiaohongshu' }]).defaultAccountId, 'source-A');
  await mutate(state => { const a = state.projects[0].assets.find(a => a.id === asset.id); delete a.history.find(item => item.revision === asset.revision).creationTrace; a.creationTrace = trace('new-B'); });
  const legacy = await api(`${path}/restore`, 'POST', { revision: asset.revision });
  assert.equal(legacy.result.creationTrace, undefined, 'restoring an unbound legacy version must not retain a later account identity');
}

test('desktop review and restoration retain the original creation account snapshot', async t => {
  const store = createStore(':memory:'), app = createApp(store), server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const api = async (path, method, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
  };
  await exercise({ mutate: work => store.mutate(work), api, read: () => store.get() });
});

test('browser review and restoration retain original identity inside the local workspace', async () => {
  globalThis.indexedDB = indexedDB;
  globalThis.window = Object.assign(new EventTarget(), { indexedDB, isSecureContext: true });
  const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
  const compiled = await build({ stdin: { contents: "export { localAPI } from './src/local-api.ts'; export { registerLocal, changeLocalState, readLocalState, lockLocalWorkspace } from './src/local-vault.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const { localAPI, registerLocal, changeLocalState, readLocalState, lockLocalWorkspace } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  await registerLocal('身份历史测试', 'test-identity-history-password');
  try { await exercise({ mutate: changeLocalState, api: localAPI, read: readLocalState }); }
  finally { lockLocalWorkspace(); }
});
