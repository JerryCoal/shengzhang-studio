import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('offline shell uses its own deployment scope and preserves other applications caches', async () => {
  const handlers = {}, removed = [], requested = [];
  const fallback = new Response('correct scoped shell');
  const scope = 'https://someone.github.io/shengzhang-studio/';
  const currentCache = `shengzhang-shell:/shengzhang-studio/:v4`;
  const context = { URL, Response, self: { registration: { scope }, skipWaiting() {}, clients: { claim() {} }, addEventListener(name, fn) { handlers[name] = fn; } },
    fetch: async () => { throw Error('offline'); }, caches: {
      keys: async () => [currentCache, 'shengzhang-shell:/shengzhang-studio/:v2', 'other-application', 'shengzhang-shell:/another-repo/:v2'],
      delete: async name => { removed.push(name); },
      open: async name => { assert.equal(name, currentCache); return { match: async key => { requested.push(key); return key === scope ? fallback : undefined; } }; },
    } };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let activation; handlers.activate({ waitUntil(p) { activation = p; } }); await activation;
  assert.deepEqual(removed, ['shengzhang-shell:/shengzhang-studio/:v2']);
  for (const url of ['https://someone.github.io/other-repo/', scope + 'api/state', scope + 'downloads/file', scope + 'backend.json?t=1', scope + 'oauth-callback.html?code=test', 'https://elsewhere.example/']) {
    handlers.fetch({ request: { url, method: 'GET', mode: 'navigate' }, respondWith() { assert.fail('Unrelated or private requests must not be cached'); } });
  }
  let response; handlers.fetch({ request: { url: scope + 'index.html', method: 'GET', mode: 'navigate' }, respondWith(p) { response = p; } });
  assert.equal(await (await response).text(), 'correct scoped shell');
  assert(requested.includes(scope));
});

test('PWA launch and icons resolve inside a GitHub repository subdirectory', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const origin = 'https://someone.github.io/shengzhang-studio/';
  for (const path of [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map(i => i.src)]) assert(new URL(path, origin).href.startsWith(origin));
});
