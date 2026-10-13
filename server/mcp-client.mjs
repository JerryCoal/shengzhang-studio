import { randomUUID } from 'node:crypto';

const failure = message => Object.assign(Error(message), { status: 502 });
export function localMCPEndpoint(value) {
  let url; try { url = new URL(value); } catch { throw failure('MCP 地址格式不正确'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') throw failure('请填写本机 MCP 地址，例如 http://127.0.0.1:18060/mcp；不接受公网地址或 URL 中的密钥。');
  return url.href;
}
async function rpcResult(response, id, maxBytes) {
  const stream = /text\/event-stream/i.test(response.headers.get('content-type') || '');
  const reader = response.body?.getReader(); if (!reader) throw failure('MCP 返回为空');
  const decoder = new TextDecoder(); let buffer = '', bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength; if (bytes > maxBytes) throw failure('MCP 返回过大，请减少评论数量');
      buffer += decoder.decode(item.value, { stream: true });
      if (stream) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let parsed; try { parsed = JSON.parse(data); } catch { throw failure('MCP 流式响应格式错误'); }
          if (parsed.id === id) return parsed;
        }
      }
    }
    buffer += decoder.decode();
    if (stream) throw failure('MCP 流式连接结束，未收到本次请求结果');
    let data; try { data = JSON.parse(buffer); } catch { throw failure('MCP 响应不是有效 JSON'); }
    if (data.id !== id) throw failure('MCP 返回的请求编号不匹配');
    return data;
  } finally { await reader.cancel().catch(() => {}); }
}
export function createMCPClient({ endpoint, token = '', fetcher = fetch, timeout = 180000 }) {
  endpoint = localMCPEndpoint(endpoint);
  let session = '', version = '2025-06-18', initialized = false;
  const headers = () => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(session ? { 'Mcp-Session-Id': session } : {}), ...(initialized ? { 'MCP-Protocol-Version': version } : {}) });
  async function request(method, params, notification = false) {
    const id = randomUUID(); let response;
    try { response = await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: headers(), signal: AbortSignal.timeout(timeout), body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }) }); }
    catch { throw failure('MCP 连接中断或超时。请检查本机服务；发布结果不明时先核对平台，不会自动重试。'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure(`MCP 服务返回 HTTP ${response.status}。请检查服务、登录及访问令牌；没有自动重试。`); }
    if (method === 'initialize') { const value = response.headers.get('Mcp-Session-Id') || ''; if (value.length > 1024 || /[^\x21-\x7e]/.test(value)) throw failure('MCP 会话编号无效'); session = value; }
    if (notification) { await response.body?.cancel().catch(() => {}); return; }
    const data = await rpcResult(response, id, 8_000_000);
    if (data.jsonrpc !== '2.0' || data.error || !Object.hasOwn(data, 'result')) throw failure('MCP 未接受操作，请检查服务版本与所需权限；错误原文不会写入工作区。');
    return data.result;
  }
  return {
    async connect() {
      const result = await request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'shengzhang-studio', version: '1.7.0' } });
      if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(result.protocolVersion)) throw failure('MCP 协议版本尚未支持，请更新服务');
      version = result.protocolVersion; initialized = true;
      await request('notifications/initialized', {}, true);
      const tools = [], cursors = new Set(); let cursor;
      for (let page = 0; page < 10; page++) {
        const list = await request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(list.tools) || tools.length + list.tools.length > 300) throw failure('MCP 工具列表无效或过大');
        tools.push(...list.tools); cursor = list.nextCursor;
        if (!cursor) return tools;
        if (typeof cursor !== 'string' || cursor.length > 2000 || cursors.has(cursor)) throw failure('MCP 工具列表分页异常'); cursors.add(cursor);
      }
      throw failure('MCP 工具列表分页超过上限');
    },
    async call(name, args) {
      if (!initialized) throw failure('请先连接 MCP');
      const result = await request('tools/call', { name, arguments: args });
      if (result.isError) throw failure('MCP 工具未完成操作。请检查登录、素材与平台页面；发布操作不要直接重复提交。');
      return result;
    },
    async close() {
      if (session) try { const response = await fetcher(endpoint, { method: 'DELETE', redirect: 'error', headers: headers(), signal: AbortSignal.timeout(2000) }); await response.body?.cancel().catch(() => {}); } catch {}
      session = ''; initialized = false; token = '';
    },
  };
}
export function mcpValue(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  for (const content of result?.content || []) if (content.type === 'text') { try { const value = JSON.parse(content.text); if (value && typeof value === 'object') return value; } catch {} }
  return null;
}
