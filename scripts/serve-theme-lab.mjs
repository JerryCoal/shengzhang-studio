import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const filename = resolve('outputs/ui-theme-lab/index.html');
const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (!['/', '/index.html'].includes(req.url?.split('?')[0])) { res.writeHead(404); return res.end(); }
  const html = readFileSync(filename);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : html);
});
server.listen(4391, '127.0.0.1', () => console.log('Theme preview: http://127.0.0.1:4391'));
