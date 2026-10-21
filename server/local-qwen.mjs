import { request as httpRequest } from 'node:http';
import { localQwenConnection } from './local-qwen-connection.mjs';
import { readBounded } from './integration-http.mjs';
import { deepseekInstructions, deepseekUsage } from './deepseek.mjs';

export const LOCAL_QWEN_BASE = 'local-qwen://workspace/v1';
const fail = (message, status = 400) => Object.assign(Error(message), { status, noCharge: true });
// Native HTTP goes directly to the validated literal loopback host. It does
// not use environment proxies, resolve hostnames, follow redirects or retry.
function directRequest(url, init) {
  return new Promise((accept, reject) => {
    const request = httpRequest(url, { method: init.method, headers: init.headers, signal: init.signal, agent: false }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 2_000_000) { response.destroy(); reject(fail('本地模型响应过大，已停止读取', 502)); } else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try { accept(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), { status: response.statusCode, headers: { 'content-type': response.headers['content-type'] || '' } })); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject); if (init.body) request.write(init.body); request.end();
  });
}
export function createLocalQwenTransport(fallback, getConnection, { allowed = true, localFetcher = directRequest } = {}) {
  return { async fetch(url, init = {}) {
    if (!String(url).startsWith('local-qwen:')) return fallback(url, init);
    if (!allowed) throw fail('独立网页版中转不能连接内网模型，请使用 Windows 完整版或团队主机', 403);
    const connection = localQwenConnection(getConnection());
    if (!connection.enabled || !connection.model) throw fail('请先保存并启用本地 Qwen 连接设置');
    const route = url === `${LOCAL_QWEN_BASE}/models` && init.method === 'GET' ? '/models' : url === `${LOCAL_QWEN_BASE}/chat/completions` && init.method === 'POST' ? '/chat/completions' : null;
    if (!route) throw fail('不支持的本地模型操作');
    let body;
    if (route === '/chat/completions') body = JSON.stringify({ ...JSON.parse(init.body), model: connection.model });
    let response;
    try { response = await localFetcher(`${connection.baseUrl}${route}`, { ...init, body, redirect: 'error', signal: AbortSignal.timeout(route === '/models' ? 15000 : 180000) }); }
    catch { throw fail('无法连接本地模型。请检查主机服务、端口与模型是否已启动；团队版连接的是团队主机，不是访问者电脑。未自动重试。', 502); }
    if (response.status >= 300 && response.status < 400) throw fail('本地模型返回了重定向，已拒绝跳转；请直接填写本机兼容服务地址。', 502);
    if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? '本地模型拒绝身份验证，请核对该本机服务的 API Key。' : response.status === 404 ? '本地模型或 /v1 接口不存在，请核对模型 ID 和服务地址。' : response.status === 429 ? '本地模型当前繁忙，请等待后手动重试。' : `本地模型请求未完成（HTTP ${response.status}）；请核对服务日志，工作站不会自动重试。`, 502);
    return response;
  } };
}
async function localRequest(path, key, body, fetcher) {
  if (!fetcher) throw fail('本地模型传输尚未配置');
  const response = await fetcher(`${LOCAL_QWEN_BASE}/${path}`, { method: body ? 'POST' : 'GET', headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try { return JSON.parse((await readBounded(response, 2_000_000)).toString('utf8')); }
  catch { throw fail('本地模型没有返回有效 JSON，请核对 OpenAI 兼容接口；原内容已保留。', 502); }
}
export async function verifyLocalQwen(key, connection, fetcher) {
  const value = await localRequest('models', key, null, fetcher);
  if (!Array.isArray(value.data) || !value.data.length) throw fail('本地服务未返回任何模型。请先自行安装并启动 Qwen 模型，再检查连接。', 502);
  if (!value.data.some(item => item?.id === connection.model)) throw fail('已连接本机服务，但列表中没有填写的模型 ID，请复制服务中的完整 ID。', 400);
  return { checkedAt: new Date().toISOString(), models: [{ model: connection.model, available: true }], note: '仅向本机 /v1/models 读取列表，未发送项目、运行生成或下载模型。模型可见不保证上下文容量或结构化输出质量。请确保服务使用本地权重，不转发至云端。' };
}
export async function generateLocalQwen(payload, config, definition, instructions, fetcher) {
  const value = await localRequest('chat/completions', config.apiKey, { stream: false, max_tokens: config.maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: deepseekInstructions(instructions, definition) }, { role: 'user', content: JSON.stringify(payload) }] }, fetcher);
  const usage = deepseekUsage(value.usage), choice = value.choices?.[0];
  try { if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw Error(); return { value: definition.validate(JSON.parse(choice.message.content), payload), usage }; }
  catch { throw Object.assign(fail(choice?.finish_reason === 'length' ? '本地模型输出达到上限，结果未写入；请缩短输入或换用足够上下文的模型。' : '本地模型未返回符合要求的 JSON 或引用，原内容已保留；请使用支持结构化输出的 Qwen 指令模型。', 502), { usage }); }
}
