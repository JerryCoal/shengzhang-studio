import { randomUUID } from 'node:crypto';
import { readBounded } from './integration-http.mjs';
import { assert, now } from './domain.mjs';
import { currentActor } from './request-actor.mjs';

export const REDFOX_ORIGIN = 'https://redfox.hk';
const errors = {
  400: '请求参数不符合 Redfox 接口要求', 401: 'Redfox 密钥无效', 403: 'Redfox 密钥没有此接口权限',
  1001: 'Redfox 接口缺少参数', 1002: 'Redfox 参数格式不正确', 1003: 'Redfox 参数类型不正确',
  3103: 'Redfox 密钥不存在', 3105: 'Redfox 密钥已禁用', 3201: 'Redfox 积分不足，请在其控制台充值后重试',
  3202: 'Redfox 积分账户异常', 4004: 'Redfox 请求过于频繁，请稍后手动重试',
};
export function redfoxError(message, code = '', uncertain = true) {
  return Object.assign(new Error(message), { status: 502, provider: 'redfox', redfoxSafe: true, code: String(code), uncertain, noCharge: !uncertain });
}

// A fixed registry is the only way to select a credential-bearing endpoint.
// No caller-provided URLs, redirects, logging of request bodies, or automatic retries.
export function createRedfoxService(store, config, preferences, catalog) {
  let pending = 0;
  const settings = () => preferences.get().redfox;
  const keyStatus = () => config.redfoxVault?.status() || {};
  const enabled = (kind = 'data') => !!settings()?.[kind === 'media' ? 'mediaEnabled' : kind === 'search' ? 'searchEnabled' : 'enabled'];
  function status() {
    const v = keyStatus(), state = store.get(), rows = state.redfoxUsage || [];
    return { ...settings(), supported: !!v.supported, configured: !!v.configured && !v.problem, suffix: v.suffix || '', problem: v.problem || '',
      verifiedAt: state.redfoxStatus?.verifiedAt || null, lastError: state.redfoxStatus?.lastError || '',
      usage: { requests: (state.redfoxUsagePrevious?.requests || 0) + rows.length, estimatedCny: (state.redfoxUsagePrevious?.estimatedCny || 0) + rows.reduce((sum, row) => sum + row.amountCny, 0) },
      notes: ['Redfox 费用按文档基础单价预留，优惠、失败退款及实际账单以 Redfox 控制台为准。', '只在你发起操作后请求；数据读取失败不会自动切换另一项收费服务。', '账号身份与 Skills 仍随生成任务使用；发布登录与平台凭证保持原有路径。'] };
  }
  async function request(operation, body = {}, context = {}) {
    assert(!config.redfoxUpdating, 'Redfox 配置正在保存，请稍后再试', 409);
    const endpoint = catalog[operation];
    assert(endpoint && /^\/story\/api\/[A-Za-z0-9/_-]+$/.test(endpoint.path), '此 Redfox 能力尚未接入', 400);
    assert(['POST', 'GET'].includes(endpoint.method || 'POST'), 'Redfox 请求方法无效');
    const v = keyStatus(); assert(v.supported && v.configured && !v.problem, '请先在连接与设置保存 Redfox API Key', 400);
    assert(pending < 8, 'Redfox 当前任务较多，请等待已有任务完成', 429);
    const multipart = body instanceof FormData;
    assert(!multipart || endpoint.multipart === true, '此 Redfox 接口不接受文件上传');
    const payload = multipart ? body : JSON.stringify(body);
    const size = multipart ? [...body.values()].reduce((n, value) => n + (typeof value === 'string' ? Buffer.byteLength(value) : value.size), 0) : Buffer.byteLength(payload);
    assert(size <= 28_000_000, 'Redfox 请求超过大小限制');
    pending++;
    let id;
    try {
      const apiKey = await config.redfoxVault.getKey(); assert(apiKey, 'Redfox 密钥不可用');
      id = randomUUID();
      const price = endpoint.priceCny;
      assert(Number.isFinite(price) && price >= 0, '此接口费用尚未核实，暂不能发起请求');
      store.mutate(state => {
        state.redfoxUsage ||= [];
        while (state.redfoxUsage.length >= 500) {
          const old = state.redfoxUsage.shift(); state.redfoxUsagePrevious ||= { requests: 0, estimatedCny: 0 };
          state.redfoxUsagePrevious.requests++; state.redfoxUsagePrevious.estimatedCny += old.amountCny;
        }
        const actor = currentActor() || context.initiatedBy;
        state.redfoxUsage.push({ id, operation, provider: 'redfox', projectId: context.projectId || '', accountId: context.accountId || '', platform: context.platform || '', assetId: context.assetId || '', stage: context.stage || '', taskId: context.taskId || '',
          ...(actor ? { actor: { userId: actor.userId, username: actor.username, role: actor.role } } : {}), amountCny: price, estimated: true, status: 'running', at: now(), note: '按文档基础单价预留，以 Redfox 账单为准' });
      });
      let url = REDFOX_ORIGIN + endpoint.path;
      const method = endpoint.method || 'POST';
      if (multipart && endpoint.queryKeys?.length) { const u = new URL(url); for (const name of endpoint.queryKeys) { const value = body.get(name); if (typeof value === 'string') u.searchParams.set(name, value); } url = u.href; }
      if (method === 'GET') { const u = new URL(url); for (const [key, value] of Object.entries(body)) u.searchParams.set(key, String(value)); url = u.href; }
      let response;
      try { response = await (config.redfoxFetcher || fetch)(url, { method, headers: { REDFOX_API_KEY: apiKey, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: payload } : {}), redirect: 'error', signal: AbortSignal.timeout(config.redfoxTimeoutMs || 60000) }); }
      catch { throw redfoxError('Redfox 请求结果不明。请核对控制台；系统没有自动重复提交。', 'network'); }
      if (!response.ok) {
        await response.body?.cancel();
        throw redfoxError(errors[response.status] || (response.status === 429 ? 'Redfox 请求受限，请稍后手动重试' : `Redfox 暂不可用（HTTP ${response.status}）`), response.status, true);
      }
      let result;
      try { result = JSON.parse((await readBounded(response, 24_000_000)).toString('utf8')); }
      catch { throw redfoxError('Redfox 返回结果不完整，请核对控制台，未自动重试。', 'invalid-response'); }
      if (Number(result?.code) !== 2000) throw redfoxError(errors[result?.code] || 'Redfox 未完成请求，请核对接口权限和控制台记录', result?.code || 'invalid-code', true);
      if (!Object.hasOwn(result, 'data')) throw redfoxError('Redfox 响应缺少数据，未自动重试。', 'invalid-data');
      store.mutate(state => {
        const row = state.redfoxUsage?.find(row => row.id === id); if (row) row.status = 'completed';
        state.redfoxStatus = { verifiedAt: now(), lastError: '' };
      });
      return result.data;
    } catch (error) {
      const message = error.provider === 'redfox' || !id ? error.message : 'Redfox 请求未完成，请核对控制台记录';
      if (id) store.mutate(state => {
        const row = state.redfoxUsage?.find(row => row.id === id); if (row) { row.status = 'uncertain'; row.note = message; }
        state.redfoxStatus = { ...state.redfoxStatus, lastError: message };
      });
      if (error.provider === 'redfox' || !id) throw error;
      throw redfoxError(message);
    } finally { pending--; }
  }
  return { enabled, status, request, busy: () => pending > 0 };
}
