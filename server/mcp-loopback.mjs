import { request } from 'node:http';
import { Readable } from 'node:stream';

// MCP is always a loopback connection. Never route tokens/media through a system proxy.
export function fetchLoopbackMCP(input, init = {}) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/mcp' || url.search || url.hash) throw new Error('Only local MCP connections are allowed');
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method || 'GET', headers: init.headers, agent: false, signal: init.signal }, res => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const empty = [204, 205, 304].includes(res.statusCode) || init.method === 'HEAD';
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.once('error', reject);
    req.end(init.body);
  });
}
