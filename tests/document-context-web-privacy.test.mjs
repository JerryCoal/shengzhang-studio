import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import express from 'express';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { createWebRelay } from '../server/web-relay.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';
import { LOCAL_DOCUMENT_KEYS } from '../server/local-document-privacy.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts'; export { webAPI } from './src/web-api.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload, webAPI } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture() {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  const a = p.assets[0], s = p.strategies[0];
  const card = { id: 'local-card', items: [{ text: 'PRIVATE_DOCUMENT_CARD_SENTINEL' }] };
  p.documentContext = { revision: 1, adopted: card, candidate: card };
  s.documentContextSnapshot = card; s.styleReferencesSnapshot = [{ text: 'PRIVATE_STYLE_SENTINEL' }];
  a.documentContextSnapshot = card; a.styleReferencesSnapshot = s.styleReferencesSnapshot;
  a.history = [{ title: '旧内容', body: '旧正文', revision: a.revision - 1, documentContextSnapshot: card, styleReferencesSnapshot: s.styleReferencesSnapshot }];
  p.corpus = [
    { id: 'fact', name: '产品说明', enabled: true, purpose: 'product_facts', text: '便携咖啡适合露营使用。', chunks: [{ index: 0, text: '便携咖啡适合露营使用。', page: 1, heading: 'PRIVATE_HEADING_SENTINEL', blockId: 'b1', kind: 'text' }], extraction: { blocks: [{ text: 'PRIVATE_RAW_BLOCK_SENTINEL' }] } },
    { id: 'style', name: '文风样本', enabled: true, purpose: 'style_sample', text: '咖啡露营 PRIVATE_STYLE_SENTINEL', chunks: [{ index: 0, text: '咖啡露营 PRIVATE_STYLE_SENTINEL' }] },
  ];
  return { state, p, a, s, path: `/projects/${p.id}/assets/${a.id}` };
}
test('local document cards, styles, raw blocks and page metadata never travel through ordinary web operations', () => {
  const { state, p, path } = fixture(), before = structuredClone(state);
  for (const endpoint of ['/settings/credential/check', `/projects/${p.id}/trends/refresh`, `/projects/${p.id}/strategies`, path + '/copy', path + '/cover', '/tick']) {
    const payload = webPayload(state, endpoint, { query: '咖啡露营' }, p.id);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_|documentContext|styleReferences|extraction|blockId/);
  }
  assert.deepEqual(state, before);
});
test('web context requests stop before storage access or network calls', async () => {
  const { state, p } = fixture();
  for (const path of [`/projects/${p.id}/corpus/context`, `/projects/${p.id}/corpus/context/adopt`]) {
    assert.throws(() => webPayload(state, path, {}, p.id), /仅支持本机/);
    await assert.rejects(webAPI(path, 'POST', {}), /仅支持本机/);
  }
});
test('web result merge preserves current local cards and exact-version historical snapshots while dropping injected cards', () => {
  const { state, p, a, s, path } = fixture(), before = structuredClone(state);
  const base = webPayload(state, path + '/copy', {}, p.id), remote = structuredClone(base), changed = remote.projects[0].assets[0];
  remote.projects[0].documentContext = { revision: 999, adopted: { id: 'injected' } };
  changed.history.unshift({ title: a.title, body: a.body, revision: a.revision });
  changed.title = '新联网文案'; changed.body = '新正文'; changed.revision++;
  changed.documentContextSnapshot = { id: 'injected' };
  const result = mergeRelayState(base, remote, state).projects[0];
  assert.deepEqual(result.documentContext, p.documentContext);
  assert.deepEqual(result.strategies[0].documentContextSnapshot, s.documentContextSnapshot);
  assert.deepEqual(result.assets[0].history[0].documentContextSnapshot, a.documentContextSnapshot);
  assert.deepEqual(result.assets[0].history[1], a.history[0]);
  assert.notEqual(result.assets[0].documentContextSnapshot?.id, 'injected');
  assert.deepEqual(result.corpus, p.corpus);
  assert.deepEqual(state, before);
});
test('relay rejects document-only fields at every nesting level before any provider request', async t => {
  let calls = 0;
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async () => { calls++; throw new Error('must not request'); } } }); root.use(app);
  t.after(async () => { await app.locals.close(); server.close(); server.closeAllConnections(); });
  for (const key of LOCAL_DOCUMENT_KEYS) {
    const state = seedState(); confirmStrategy(state.projects[0], state.projects[0].strategies[0].id); state.projects[0].assets[0].history = [{ [key]: {} }];
    const response = await fetch(base + '/api/web/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ path: '/settings/credential/check', method: 'POST', body: {}, state, credentials: {}, routes: DEFAULT_ROUTES, authorizations: [] }) });
    assert.equal(response.status, 400, key);
  }
  assert.equal(calls, 0);
});
