import { readBounded } from './integration-http.mjs';
import { deepseekInstructions, deepseekUsage } from './deepseek.mjs';
import { assert } from './domain.mjs';
import { isQwenUrl, qwenConnection, qwenRequestUrl } from './qwen-connection.mjs';

export const QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const QWEN_MODELS = ['qwen-plus', 'qwen-flash'];
export function createQwenTransport(fetcher = fetch, getConnection = () => undefined) {
  let last = null; const cooldowns = new Map();
  return {
    diagnostic: () => last ? structuredClone(last) : null,
    reset() { last = null; cooldowns.clear(); },
    async fetch(url, init = {}) {
      if (!isQwenUrl(url)) return fetcher(url, init);
      const connection = qwenConnection(getConnection());
      url = qwenRequestUrl(url, { region: connection.region, workspaceId: connection.workspaceId });
      let model; try { const id = JSON.parse(init.body || '{}').model; if (QWEN_MODELS.includes(id)) model = id; } catch {}
      const endpoint = String(url).endsWith('/models') ? 'models' : 'responses', scope = `${connection.baseUrl}:${endpoint}:${model || ''}`;
      const previous = cooldowns.get(scope);
      if (previous && Date.parse(previous.retryAt) > Date.now()) throw Object.assign(Error('Qwen 仍在限流等待期，请稍后重试。本次未发送新请求。'), { status: 429, noCharge: true, diagnostic: previous });
      try {
        const response = await fetcher(url, init);
        if (response.ok) { if (last?.endpoint === endpoint && last?.model === model) last = null; return response; }
        const code = response.status;
        const seconds = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 86400) : 60;
        let upstreamCode = '';
        try { const body = JSON.parse((await readBounded(response, 16384)).toString('utf8')); upstreamCode = String(body.error?.code || body.code || '').toLowerCase(); } catch {}
        const quota = /^(?:insufficient_quota|quotaexhausted|arrearage|accountoverdue|allocationquota\.freequotaexhausted|quotaexceeded)$/.test(upstreamCode);
        const permission = /^(?:accessdenied|model\.accessdenied|forbidden|permissiondenied)$/.test(upstreamCode);
        const descriptions = { 400: '请求参数或模型不支持，请检查所选模型。', 401: `鉴权未通过：当前选择${connection.label}。请确认 API Key 与地域、业务空间一致，且不是 AccessKey、Coding Plan 或 Token Plan 专用密钥；这不代表刚保存的字符格式错误。`, 402: '余额或额度不足，请在百炼控制台检查账单。', 403: '账户、业务空间、IP 白名单或模型权限受限，请检查百炼控制台。', 404: '模型或接口不存在，请检查所选地域、业务空间和模型开通状态。', 429: `请求频率受限，请至少等待 ${wait} 秒。` };
        const message = `Qwen ${quota ? '余额、免费额度或已设配额不足，请查看百炼账单与额度；反复修改密钥不会恢复额度。' : permission ? descriptions[403] : descriptions[code] || `服务暂时未完成请求（HTTP ${code}），请核对账单后再试。`}`;
        const rateLimit = code === 429 && !quota;
        const diagnostic = { provider: 'qwen', kind: quota ? 'quota' : permission ? 'permission' : rateLimit ? 'rate_limit' : code === 401 ? 'authentication' : 'service', code: `http_${code}`, upstreamStatus: code, endpoint, region: connection.region, ...(model ? { model } : {}), message, at: new Date().toISOString(), ...(rateLimit ? { retryAfterSeconds: wait, retryAt: new Date(Date.now() + wait * 1000).toISOString() } : {}) };
        throw Object.assign(Error(message), { status: 502, noCharge: code >= 400 && code < 500 && code !== 408, diagnostic });
      } catch (error) {
        const message = '未能完成与 Qwen 的连接，请检查网络。如已发出请求，请核对账单后再试。';
        const safe = error.diagnostic ? error : Object.assign(Error(message), { status: 502, diagnostic: { provider: 'qwen', kind: 'network', code: 'connection_failed', endpoint, ...(model ? { model } : {}), message, at: new Date().toISOString() } });
        last = safe.diagnostic; if (last.kind === 'rate_limit') cooldowns.set(scope, last); throw safe;
      }
    },
  };
}
async function request(path, key, body, fetcher) {
  const response = await createQwenTransport(fetcher).fetch(QWEN_BASE + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(180000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try { return JSON.parse((await readBounded(response, 2_000_000)).toString('utf8')); }
  catch { throw Object.assign(Error('Qwen 返回内容无法读取，现有文案已保留，请核对账单。'), { status: 502 }); }
}
export async function verifyQwen(key, fetcher, connectionValue) {
  const result = await request('/models', key, null, fetcher);
  assert(Array.isArray(result.data), 'Qwen 模型列表响应无效', 502);
  const visible = new Set(result.data.map(m => m.id));
  return { checkedAt: new Date().toISOString(), models: QWEN_MODELS.map(model => ({ model, available: visible.has(model) })), note: `已读取百炼${qwenConnection(connectionValue).label}地域模型列表，未进行付费生成。模型可见性不代表额度或生成权限。` };
}
export async function generateQwen(payload, config, definition, instructions, fetcher) {
  const result = await request('/chat/completions', config.apiKey, { model: config.model, stream: false, enable_thinking: false, max_tokens: config.maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: deepseekInstructions(instructions, definition) }, { role: 'user', content: JSON.stringify(payload) }] }, fetcher);
  const usage = deepseekUsage(result.usage);
  try { const choice = result.choices?.[0]; assert(choice?.finish_reason === 'stop' && typeof choice.message?.content === 'string', 'Qwen 未完成', 502); return { value: definition.validate(JSON.parse(choice.message.content), payload), usage }; }
  catch { throw Object.assign(Error('Qwen 结果不完整或引用不符合要求，现有内容已保留；费用按用量或预留金额记录。'), { status: 502, usage }); }
}
