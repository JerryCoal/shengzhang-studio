import { z } from 'zod';
import { readBounded } from './integration-http.mjs';
import { assert } from './domain.mjs';
import { deepseekInstructions, deepseekUsage } from './deepseek.mjs';

// Official standard API; Coding Plan credentials/endpoint are deliberately separate.
// https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
// https://docs.bigmodel.cn/cn/guide/start/pricing
export const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4';
export const GLM_MODELS = ['glm-5.3', 'glm-5.3-flash', 'glm-4.7-flash'];
export const glmCredentialSchema = z.object({ apiKey: z.string().trim().min(16).max(512).regex(/^[A-Za-z0-9._-]+$/, '请填写完整的智谱标准 API Key，不要包含空格或 Bearer 前缀') }).strict();

export function createGLMTransport(fetcher = fetch) {
  let last = null; const cooldowns = new Map();
  return {
    diagnostic: () => last ? structuredClone(last) : null,
    reset() { last = null; cooldowns.clear(); },
    async fetch(url, init = {}) {
      if (new URL(url).origin !== 'https://open.bigmodel.cn') return fetcher(url, init);
      let model, probe = false;
      try { const body = JSON.parse(init.body || '{}'); if (GLM_MODELS.includes(body.model)) model = body.model; probe = body.model === 'glm-4.7-flash' && body.max_tokens === 16; } catch { /* Never store request content. */ }
      const endpoint = probe ? 'models' : 'responses';
      const scope = `${endpoint}:${model || ''}`, previous = cooldowns.get(scope);
      if (previous && Date.parse(previous.retryAt) > Date.now()) throw Object.assign(Error('GLM 仍在限流等待期，请稍后重试。本次未发送新请求。'), { status: 429, noCharge: true, diagnostic: previous });
      try {
        const response = await fetcher(url, init);
        if (response.ok) { if (last?.endpoint === endpoint && last?.model === model) last = null; return response; }
        let code = '';
        try { const body = JSON.parse((await readBounded(response, 16384)).toString('utf8')); const value = String(body.error?.code || ''); if (/^\d{4}$/.test(value)) code = value; } catch { /* Error messages may contain secrets. */ }
        const seconds = Number(response.headers.get('retry-after')), wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 86400) : 60;
        const billing = code === '1113' || response.status === 402;
        const permission = ['1311', '1314', '1315'].includes(code) || [403, 404].includes(response.status);
        const quota = ['1308', '1309', '1310', '1316', '1317', '1318', '1319', '1320', '1321'].includes(code);
        const auth = response.status === 401;
        const rateLimit = response.status === 429 && !billing && !permission && !quota;
        const kind = billing ? 'billing' : permission ? 'permission' : quota ? 'quota' : auth ? 'authentication' : code === '1301' ? 'content' : rateLimit ? 'rate_limit' : 'service';
        const explanation = billing ? '账户余额不足，请到智谱控制台充值或检查账单；创建新密钥不会增加余额。' : permission ? '模型权限或密钥类型不匹配。请使用智谱标准模型 API Key，检查模型开通状态；Coding Plan 专用密钥不能用于此接口。' : quota ? '账户额度或套餐使用上限已达到，请到智谱控制台核对限额与密钥类型。' : auth ? '密钥验证失败，请检查智谱标准 API Key 是否完整、有效，且不是 Coding Plan 专用密钥。' : code === '1301' ? '内容检查未通过，请检查输入和生成要求后再试。' : rateLimit ? `请求频率受限，请至少等待 ${wait} 秒后重试。` : response.status === 400 ? '请求参数或模型不支持，请检查所选模型并更新应用。' : `服务暂时未完成请求（HTTP ${response.status}），请核对服务状态与账单。`;
        const message = `GLM ${explanation}`;
        const diagnostic = { provider: 'glm', kind, code: code || `http_${response.status}`, upstreamStatus: response.status, endpoint, ...(model ? { model } : {}), message, at: new Date().toISOString(), ...(rateLimit ? { retryAfterSeconds: wait, retryAt: new Date(Date.now() + wait * 1000).toISOString() } : {}) };
        throw Object.assign(Error(message), { status: 502, noCharge: response.status >= 400 && response.status < 500 && response.status !== 408, diagnostic });
      } catch (error) {
        const message = '未能完成与 GLM 的连接，请检查网络。若已发出请求，请核对智谱账单后再试，避免重复生成。';
        const safe = error.diagnostic ? error : Object.assign(Error(message), { status: 502, diagnostic: { provider: 'glm', kind: 'network', code: 'connection_failed', endpoint, ...(model ? { model } : {}), message, at: new Date().toISOString() } });
        last = safe.diagnostic; if (last.kind === 'rate_limit') cooldowns.set(scope, last); throw safe;
      }
    },
  };
}
async function request(key, body, fetcher = fetch) {
  const response = await createGLMTransport(fetcher).fetch(`${GLM_BASE}/chat/completions`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return JSON.parse((await readBounded(response, 2_000_000)).toString('utf8')); }
  catch { throw Object.assign(Error('GLM 返回内容无法读取。现有内容已保留，请核对账单后重试。'), { status: 502 }); }
}
export async function verifyGLM(key, fetcher) {
  const result = await request(key, { model: 'glm-4.7-flash', thinking: { type: 'disabled' }, stream: false, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK only.' }] }, fetcher);
  assert(result.choices?.[0]?.message?.content?.trim(), 'GLM 免费模型连接检查未返回有效结果，请在控制台核对权限', 502);
  return { checkedAt: new Date().toISOString(), probe: 'free-generation', models: GLM_MODELS.map(model => ({ model, available: model === 'glm-4.7-flash' ? true : null })), note: '已用官方免费 GLM-4.7-Flash 发送固定连接探测，未发送项目资料。仅确认密钥与免费模型可调用；付费模型权限和余额仍需在实际调用时验证。免费政策以智谱最新公告为准。' };
}
export async function generateGLM(payload, config, definition, instructions, fetcher) {
  const current = config.model.startsWith('glm-5.3');
  const result = await request(config.apiKey, { model: config.model, stream: false, max_tokens: config.maxTokens, thinking: { type: current ? 'enabled' : 'disabled' }, ...(current ? { reasoning_effort: config.effort === 'low' ? 'low' : 'high' } : {}), response_format: { type: 'json_object' }, messages: [{ role: 'system', content: deepseekInstructions(instructions, definition) }, { role: 'user', content: JSON.stringify(payload) }] }, fetcher);
  const usage = deepseekUsage(result.usage), choice = result.choices?.[0];
  try {
    assert(choice?.finish_reason === 'stop' && typeof choice.message?.content === 'string', 'GLM 输出未完成', 502);
    return { value: definition.validate(JSON.parse(choice.message.content), payload), usage };
  } catch {
    throw Object.assign(Error(choice?.finish_reason === 'length' ? 'GLM 输出达到长度上限，结果不完整。现有内容已保留；费用按返回用量或预留金额记录。' : 'GLM 结果不完整或引用不符合要求。现有内容已保留；费用按返回用量或预留金额记录。'), { status: 502, usage });
  }
}
