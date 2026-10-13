import { readBounded } from './integration-http.mjs';
import { deepseekInstructions, deepseekUsage } from './deepseek.mjs';
import { assert } from './domain.mjs';

export const QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const QWEN_MODELS = ['qwen-plus', 'qwen-flash'];
export function createQwenTransport(fetcher = fetch) {
  let last = null; const cooldowns = new Map();
  return {
    diagnostic: () => last ? structuredClone(last) : null,
    reset() { last = null; cooldowns.clear(); },
    async fetch(url, init = {}) {
      if (!String(url).startsWith(QWEN_BASE + '/')) return fetcher(url, init);
      let model; try { const id = JSON.parse(init.body || '{}').model; if (QWEN_MODELS.includes(id)) model = id; } catch {}
      const endpoint = String(url).endsWith('/models') ? 'models' : 'responses', scope = `${endpoint}:${model || ''}`;
      const previous = cooldowns.get(scope);
      if (previous && Date.parse(previous.retryAt) > Date.now()) throw Object.assign(Error('Qwen 仍在限流等待期，请稍后重试。本次未发送新请求。'), { status: 429, noCharge: true, diagnostic: previous });
      try {
        const response = await fetcher(url, init);
        if (response.ok) { if (last?.endpoint === endpoint && last?.model === model) last = null; return response; }
        const code = response.status;
        const seconds = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 86400) : 60;
        await response.body?.cancel().catch(() => {});
        const descriptions = { 400: '请求参数或模型不支持，请检查所选模型。', 401: '密钥无效，请使用阿里云百炼北京地域的 API Key。', 402: '余额不足，请在百炼控制台检查账单。', 403: '账户、模型权限或余额受限，请检查百炼控制台。', 404: '模型或接口不存在，请检查模型开通状态与地域。', 429: `请求频率受限，请至少等待 ${wait} 秒。` };
        const message = `Qwen ${descriptions[code] || `服务暂时未完成请求（HTTP ${code}），请核对账单后再试。`}`;
        const diagnostic = { provider: 'qwen', kind: code === 429 ? 'rate_limit' : code === 401 ? 'authentication' : 'service', code: `http_${code}`, upstreamStatus: code, endpoint, ...(model ? { model } : {}), message, at: new Date().toISOString(), ...(code === 429 ? { retryAfterSeconds: wait, retryAt: new Date(Date.now() + wait * 1000).toISOString() } : {}) };
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
export async function verifyQwen(key, fetcher) {
  const result = await request('/models', key, null, fetcher);
  assert(Array.isArray(result.data), 'Qwen 模型列表响应无效', 502);
  const visible = new Set(result.data.map(m => m.id));
  return { checkedAt: new Date().toISOString(), models: QWEN_MODELS.map(model => ({ model, available: visible.has(model) })), note: '已读取百炼北京地域模型列表，未进行付费生成。模型可见性不代表额度或生成权限。' };
}
export async function generateQwen(payload, config, definition, instructions, fetcher) {
  const result = await request('/chat/completions', config.apiKey, { model: config.model, stream: false, enable_thinking: false, max_tokens: config.maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: deepseekInstructions(instructions, definition) }, { role: 'user', content: JSON.stringify(payload) }] }, fetcher);
  const usage = deepseekUsage(result.usage);
  try { const choice = result.choices?.[0]; assert(choice?.finish_reason === 'stop' && typeof choice.message?.content === 'string', 'Qwen 未完成', 502); return { value: definition.validate(JSON.parse(choice.message.content), payload), usage }; }
  catch { throw Object.assign(Error('Qwen 结果不完整或引用不符合要求，现有内容已保留；费用按用量或预留金额记录。'), { status: 502, usage }); }
}
