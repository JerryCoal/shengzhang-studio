import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fetchLoopbackMCP } from '../server/mcp-loopback.mjs';
const { startDesktopMCP } = createRequire(import.meta.url)('../desktop/mcp-server.cjs');

test('local MCP transport bypasses environment proxies without dropping its authentication', async t => {
  let proxyCalls = 0, localCalls = 0;
  const proxy = createServer((_req, res) => { proxyCalls++; res.writeHead(502); res.end('proxy must not receive credentials'); });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const local = createServer((req, res) => {
    localCalls++; assert.equal(req.url, '/mcp'); assert.equal(req.headers.authorization, 'Bearer synthetic-loopback-only-test-token');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
  }); local.listen(0, '127.0.0.1'); await once(local, 'listening');
  t.after(() => { proxy.close(); proxy.closeAllConnections(); local.close(); local.closeAllConnections(); });
  const endpoint = `http://127.0.0.1:${local.address().port}/mcp`, proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const script = `import { fetchLoopbackMCP } from ${JSON.stringify(pathToFileURL(resolve('server/mcp-loopback.mjs')).href)}; const r=await fetchLoopbackMCP(${JSON.stringify(endpoint)},{method:'POST',headers:{Authorization:'Bearer synthetic-loopback-only-test-token'},body:'{}',signal:AbortSignal.timeout(5000)}); console.log(JSON.stringify({status:r.status,value:await r.json()}));`;
  const child = spawn(process.execPath, ['--use-env-proxy', '--input-type=module', '-e', script], { env: { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: '', no_proxy: '', NODE_USE_ENV_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', error = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, error); assert.deepEqual(JSON.parse(output), { status: 200, value: { ok: true } });
  assert.equal(localCalls, 1); assert.equal(proxyCalls, 0);
});

test('local MCP transport rejects remote or credential URLs and never follows HTTP redirects', async t => {
  for (const value of ['https://127.0.0.1/mcp', 'http://127.0.0.2/mcp', 'http://localhost.evil.test/mcp', 'http://example.com/mcp', 'http://username:password@127.0.0.1/mcp', 'http://127.0.0.1/mcp?token=value', 'http://127.0.0.1/mcp#secret', 'http://127.0.0.1/other']) assert.throws(() => fetchLoopbackMCP(value), /local MCP/);
  let calls = 0; const server = createServer((_req, res) => { calls++; res.writeHead(302, { Location: 'https://must-not-follow.example/mcp' }); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.close(); server.closeAllConnections(); });
  const response = await fetchLoopbackMCP(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 302); await response.text(); assert.equal(calls, 1);
});

test('desktop MCP still requires the private transport token and rejects browser origins before invoking tools', async t => {
  let called = 0; const token = 'synthetic-desktop-mcp-only-token';
  const server = await startDesktopMCP({ token, execute: async () => { called++; return { captured: true }; } }); t.after(() => server.close());
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'fixture', method: 'tools/call', params: { name: 'studio_comments', arguments: { sessionToken: 'synthetic-workspace-test' } } });
  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: 'Bearer ' + token, Origin: 'http://127.0.0.1' }]) {
    const denied = await fetchLoopbackMCP(server.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) }); assert.equal(denied.status, 403); await denied.text();
  }
  assert.equal(called, 0);
  const good = await fetchLoopbackMCP(server.endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body, signal: AbortSignal.timeout(5000) });
  assert.equal(good.status, 200); assert.equal((await good.json()).result.structuredContent.captured, true); assert.equal(called, 1);
  const wrongPath = await fetch(server.endpoint + '/extra', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body }); assert.equal(wrongPath.status, 405);
});

test('desktop MCP repair restarts on the same endpoint and retains authentication and tool capabilities', async t => {
  const token = 'restart-synthetic-token', server = await startDesktopMCP({ token, execute: async () => ({ done: true }) }); t.after(() => server.close());
  const original = server.endpoint;
  for (let i = 0; i < 2; i++) {
    const repaired = await server.restart(); assert.equal(repaired.ok, true); assert.equal(server.endpoint, original);
    const denied = await fetchLoopbackMCP(original, { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) }); assert.equal(denied.status, 403); await denied.text();
    const tools = await fetchLoopbackMCP(original, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/list' }), signal: AbortSignal.timeout(5000) });
    assert.equal(tools.status, 200); assert.deepEqual((await tools.json()).result.tools.map(tool => tool.name), ['studio_publish', 'studio_comments']);
  }
});

test('desktop MCP repair cannot interrupt an active publishing or comment task', async t => {
  let release, started; const began = new Promise(resolve => { started = resolve; });
  const token = 'busy-restart-synthetic-token', server = await startDesktopMCP({ token, execute: async () => { started(); await new Promise(resolve => { release = resolve; }); return { done: true }; } }); t.after(() => server.close());
  const pending = fetchLoopbackMCP(server.endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 'busy', method: 'tools/call', params: { name: 'studio_comments', arguments: {} } }), signal: AbortSignal.timeout(5000) });
  await began;
  await assert.rejects(server.restart(), /平台窗口正在操作/);
  release(); assert.equal((await (await pending).json()).result.structuredContent.done, true);
  assert.equal((await server.restart()).ok, true);
});
