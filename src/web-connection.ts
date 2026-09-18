export const webCallbackUrl = () => import.meta.env?.VITE_WEB_DISCOVERY ? new URL('oauth-callback.html', document.baseURI).href : `${location.origin}/oauth/douyin/callback`;

export async function resolveWebBackend(): Promise<string> {
  if (!import.meta.env?.VITE_WEB_DISCOVERY) return '';
  const address = new URL(import.meta.env.VITE_WEB_DISCOVERY, document.baseURI);
  if (address.origin !== location.origin) throw new Error('网站连接配置地址无效，尚未发送项目或密钥');
  address.searchParams.set('t', String(Date.now()));
  const response = await fetch(address, { redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('网站后端尚未准备好，请稍后重试；尚未发送项目或密钥');
  const config = await response.json();
  if (config.enabled !== true || !Number.isFinite(Date.parse(config.expiresAt)) || Date.parse(config.expiresAt) <= Date.now()) throw new Error('电脑后端当前离线，请联系网站管理员启动服务；本地数据仍可使用');
  const backend = new URL(config.backend);
  if (backend.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(backend.hostname) || backend.href !== backend.origin + '/' || backend.username || backend.password || backend.port) throw new Error('网站后端地址未通过校验，尚未发送项目或密钥');
  const health = await fetch(backend.origin + '/api/health', { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!health.ok || (await health.json()).mode !== 'web-local') throw new Error('电脑后端暂时无法连接；尚未发送项目或密钥');
  return backend.origin;
}

export async function requestWebOperation(endpoint: string, encoded: string): Promise<Response> {
  // Same-origin deployments retain the existing protocol. Split hosting polls short
  // requests so long model generations do not hit a tunnel's HTTP response timeout.
  if (!endpoint) return fetch('/api/web/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: encoded, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(350000) });
  const response = await fetch(endpoint + '/api/web/jobs', { redirect: 'error', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: encoded, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(60000) });
  if (response.status !== 202) return response;
  const { job } = await response.json();
  if (!/^[a-f0-9]{64}$/.test(job)) throw new Error('联网任务编号无效，请核对服务商记录');
  const deadline = Date.now() + 350000;
  const headers = { 'X-Studio-Client': 'studio-v1', Authorization: `Bearer ${job}` };
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    let result: Response;
    try { result = await fetch(endpoint + '/api/web/jobs', { redirect: 'error', headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
    catch { continue; } // Retry only reading the same job, never repeat a paid POST.
    if (result.status === 202) continue;
    if (!result.ok) throw new Error('联网任务暂时无法取回，请核对服务商记录，勿重复提交');
    const bytes = await result.arrayBuffer();
    try { await fetch(endpoint + '/api/web/jobs', { redirect: 'error', method: 'DELETE', headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) }); } catch { /* Server expires undelivered acknowledgements in five minutes. */ }
    return new Response(bytes, { status: result.status, headers: result.headers });
  }
  throw new Error('等待联网结果超时，请核对服务商记录，勿重复提交');
}
