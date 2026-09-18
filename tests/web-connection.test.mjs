import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ entryPoints: ['src/web-connection.ts'], bundle: true, format: 'esm', platform: 'node', write: false, define: { 'import.meta.env.VITE_WEB_DISCOVERY': JSON.stringify('./backend.json') } });
const { resolveWebBackend, requestWebOperation } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const originalFetch = globalThis.fetch;
globalThis.document = { baseURI: 'https://jerrycoal.github.io/shengzhang-studio/' };
globalThis.location = new URL(document.baseURI);

test('home backend discovery rejects expired and untrusted destinations before credentials can be sent', async t => {
  t.after(() => { globalThis.fetch = originalFetch; });
  let config = { enabled: true, backend: 'https://studio-test.trycloudflare.com', expiresAt: new Date(Date.now() + 60000).toISOString() }, calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return String(url).includes('backend.json') ? Response.json(config) : Response.json({ mode: 'web-local' }); };
  assert.equal(await resolveWebBackend(), config.backend); assert.equal(calls.length, 2); assert(calls[0].url.startsWith(document.baseURI + 'backend.json?'));
  for (const request of calls) { assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.redirect, 'error'); assert.equal(request.init.body, undefined); }
  calls = []; config.backend = 'https://malicious.example'; await assert.rejects(resolveWebBackend(), /地址未通过校验/); assert.equal(calls.length, 1);
  config.backend = 'http://127.0.0.1:4318'; await assert.rejects(resolveWebBackend(), /地址未通过校验/);
  config.expiresAt = '2020-01-01T00:00:00Z'; await assert.rejects(resolveWebBackend(), /离线/);
});

test('home request polling repeats only reads, acknowledges delivery, and never repeats a paid POST', async t => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [], job = 'b'.repeat(64); let reads = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, 'error');
    if (init.method === 'POST') return Response.json({ job }, { status: 202 });
    assert.equal(init.headers.Authorization, `Bearer ${job}`); assert.equal(init.body, undefined);
    if (init.method === 'DELETE') return Response.json({ ok: true });
    if (++reads === 1) throw new Error('temporary network interruption');
    return Response.json({ status: 200, state: { projects: [] }, response: { ok: true } });
  };
  const result = await requestWebOperation('https://studio-test.trycloudflare.com', '{"credentials":{"deepseek":"test-only"}}');
  assert.equal((await result.json()).status, 200);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 1); assert.equal(reads, 2); assert.equal(calls.at(-1).init.method, 'DELETE');
});
