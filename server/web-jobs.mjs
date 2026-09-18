import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

// Short-lived request memory only. Nothing here is written to disk.
export function createWebJobs({ host, publicOrigin = `https://${host}`, maxJobs = 4, retentionMs = 300000, now = Date.now } = {}) {
  const jobs = new Map();
  const prune = () => { for (const [id, job] of jobs) if (job.expires <= now() && job.done) jobs.delete(id); };
  const timer = setInterval(prune, 30000); timer.unref();
  return {
    size() { prune(); return jobs.size; },
    start(req) {
      prune(); if (jobs.size >= maxJobs) return null;
      const id = randomBytes(32).toString('hex'), job = { done: false, expires: Infinity, status: 202, value: null };
      jobs.set(id, job);
      const finish = (status, value) => { job.status = status; job.value = value; job.done = true; job.expires = now() + retentionMs; };
      // The destination is this server's actual local port, never a client URL.
      const upstream = httpRequest({ hostname: '127.0.0.1', port: req.socket.localPort, path: '/api/web/execute', method: 'POST', headers: {
        Host: host, Origin: req.get('Origin') || publicOrigin, 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1',
      } }, response => {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) upstream.destroy(new Error('Response too large')); else chunks.push(chunk); });
        response.on('end', () => { try { finish(response.statusCode, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(502, { error: '联网结果无法读取，请核对服务商记录，勿重复提交' }); } });
        response.on('error', () => finish(502, { error: '联网结果中断，请核对服务商记录，勿重复提交' }));
      });
      upstream.setTimeout(350000, () => upstream.destroy(new Error('Request timeout')));
      upstream.on('error', () => finish(502, { error: '联网请求状态不明，请核对服务商记录，勿重复提交' }));
      upstream.end(JSON.stringify(req.body));
      return id;
    },
    read(id) { prune(); return /^[a-f0-9]{64}$/.test(id || '') ? jobs.get(id) : undefined; },
    remove(id) { const job = jobs.get(id); if (job?.done) jobs.delete(id); },
    close() { clearInterval(timer); jobs.clear(); },
  };
}
