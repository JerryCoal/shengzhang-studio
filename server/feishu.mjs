import { z } from 'zod';
import { readBounded } from './integration-http.mjs';

const fail = (message, extra = {}) => Object.assign(new Error(message), { status: 400, ...extra });
export const FEISHU_FIELDS = [
  { field_name: '计划编号', type: 1 }, { field_name: '项目', type: 1 },
  { field_name: '平台', type: 3, property: { options: [{ name: '小红书' }, { name: '抖音' }] } },
  { field_name: '发布账号', type: 1 }, { field_name: '标题', type: 1 },
  { field_name: '计划发布时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } },
  { field_name: '发布状态', type: 3, property: { options: ['待发布', '已导出', '已发布', '已取消'].map(name => ({ name })) } },
  { field_name: '作品链接', type: 15 }, { field_name: '负责人', type: 1 }, { field_name: '团队备注', type: 1 },
];
export const MANAGED_FIELDS = FEISHU_FIELDS.slice(0, 8).map(f => f.field_name);
export const feishuCredentialsSchema = z.object({ appId: z.string().trim().regex(/^cli_[A-Za-z0-9]{6,80}$/, '请填写飞书应用 App ID'), appSecret: z.string().trim().min(8).max(512).regex(/^[A-Za-z0-9_.-]+$/, 'App Secret 格式不正确') }).strict();

export function parseFeishuTarget(value) {
  let url; try { url = new URL(value); } catch { throw fail('请粘贴飞书多维表格中具体数据表的链接'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn'))) throw fail('请使用 feishu.cn 域名的 HTTPS 多维表格链接');
  const match = url.pathname.match(/^\/base\/([A-Za-z0-9]{8,100})\/?$/);
  if (!match) throw fail('第一版请使用含 /base/ 的多维表格链接。知识库链接请在飞书中打开原始多维表格后复制链接。');
  const tableId = url.searchParams.get('table');
  if (!/^tbl[A-Za-z0-9]{4,100}$/.test(tableId || '')) throw fail('链接缺少数据表编号，请点选具体数据表后复制地址（含 table=）');
  return { appToken: match[1], tableId, tableUrl: `${url.origin}/base/${match[1]}?table=${tableId}` };
}
export function schemaReport(fields) {
  const missing = [], incompatible = [];
  for (const expected of FEISHU_FIELDS) {
    const field = fields.find(f => f.field_name === expected.field_name);
    if (!field) missing.push(expected.field_name);
    else if (field.type !== expected.type) incompatible.push(expected.field_name);
  }
  return { missing, incompatible, ready: !missing.length && !incompatible.length };
}
// Only read the documented field value types. An unexpected response must not become a blank cell.
export function canonicalFields(fields) {
  const out = {};
  for (const key of MANAGED_FIELDS) {
    const value = fields[key];
    if (value == null) { out[key] = key === '计划发布时间' ? null : ''; continue; }
    if (key === '计划发布时间') { if (typeof value !== 'number') throw fail('飞书日期返回格式无法识别，请重新检查字段类型'); out[key] = value; }
    else if (key === '作品链接') { if (typeof value !== 'object' || typeof value.link !== 'string') throw fail('飞书链接返回格式无法识别'); out[key] = value.link; }
    else if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && value.every(v => v && typeof v.text === 'string')) out[key] = value.map(v => v.text).join('');
    else throw fail(`飞书“${key}”返回格式无法识别，请检查字段类型`);
  }
  return out;
}
export function planFields(project, record) {
  const time = new Date(record.scheduledAt).getTime();
  if (!Number.isFinite(time)) throw fail('计划时间无效，请重新安排');
  return {
    '计划编号': `${project.id}:${record.id}`, '项目': project.brief.name,
    '平台': record.platform === 'xiaohongshu' ? '小红书' : '抖音', '发布账号': record.accountName,
    '标题': record.title, '计划发布时间': time,
    '发布状态': ({ scheduled: '待发布', exported: '已导出', published: '已发布', cancelled: '已取消' })[record.status],
    '作品链接': record.url ? { link: record.url, text: '查看作品' } : null,
  };
}

export function createFeishuClient({ credentials, fetcher = fetch, clock = Date.now }) {
  let token = '', expires = 0;
  async function raw(path, method, body, bearer) {
    let response, data;
    try {
      response = await fetcher(`https://open.feishu.cn/open-apis/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      data = JSON.parse((await readBounded(response, 3_000_000)).toString('utf8'));
    } catch { throw fail('飞书连接中断或返回异常；本地计划已保留，可稍后重试。', { status: 502, retryable: true, uncertain: true }); }
    if (response.ok && data?.code === 0) return data;
    const code = Number(data?.code), extra = { status: 502, feishuCode: code };
    if ([99991661, 99991663, 99991664, 99991668].includes(code)) throw fail('飞书访问凭证已失效，请重新连接', { ...extra, tokenExpired: true });
    if ([99991672, 91403, 1254302, 1254304].includes(code) || response.status === 403) throw fail('飞书权限不足。请开通表格读写权限、发布应用，并在目标表格“添加文档应用”中授权；如启用高级权限，还需允许应用访问这些行列。', extra);
    if ([99991664, 10003, 10014].includes(code) || response.status === 401) throw fail('飞书应用凭证无效，请检查 App ID、App Secret 和应用发布状态。', extra);
    if ([1254003, 1254004, 1254040].includes(code)) throw fail('未找到飞书表格，请检查链接及应用访问权限。', extra);
    if ([1254006, 1254043].includes(code)) throw fail('飞书记录已删除或无法访问，请核对后重试。', { ...extra, missingRecord: true });
    if (response.status === 429 || [1254290, 1254291, 1254607, 99991400].includes(code)) throw fail('飞书请求暂时受限或表格正在处理，请稍后重试。', { ...extra, retryable: true });
    if (code === 1255006) throw fail('这次写入的防重复标识发生冲突，请先核对飞书记录。系统已保留原请求，不会换编号重复创建。', extra);
    throw fail(`飞书操作未完成（${Number.isFinite(code) ? `代码 ${code}` : `HTTP ${response.status}`}）。请检查字段类型、应用权限及表格状态。`, { ...extra, retryable: response.status >= 500, uncertain: response.status >= 500 });
  }
  async function accessToken() {
    if (token && expires > clock()) return token;
    const value = feishuCredentialsSchema.parse(await credentials());
    const data = await raw('auth/v3/tenant_access_token/internal', 'POST', { app_id: value.appId, app_secret: value.appSecret });
    if (typeof data.tenant_access_token !== 'string' || !Number.isFinite(data.expire) || data.expire <= 0) throw fail('飞书未返回有效访问凭证', { status: 502 });
    token = data.tenant_access_token; expires = clock() + Math.max(1, data.expire - 120) * 1000; return token;
  }
  async function request(path, method = 'GET', body) {
    try { return (await raw(path, method, body, await accessToken())).data; }
    catch (error) { if (!error.tokenExpired) throw error; token = ''; return (await raw(path, method, body, await accessToken())).data; }
  }
  const base = t => `bitable/v1/apps/${encodeURIComponent(t.appToken)}/tables/${encodeURIComponent(t.tableId)}`;
  return {
    clear() { token = ''; expires = 0; },
    async fields(target) {
      const items = []; let page = ''; const seen = new Set();
      do {
        const data = await request(`${base(target)}/fields?page_size=100${page ? `&page_token=${encodeURIComponent(page)}` : ''}`);
        if (!Array.isArray(data?.items)) throw fail('飞书未返回有效字段列表', { status: 502 });
        items.push(...data.items);
        if (!data.has_more) break;
        if (!data.page_token || seen.has(data.page_token) || seen.size >= 20) throw fail('飞书字段分页异常，请重试', { status: 502 });
        page = data.page_token; seen.add(page);
      } while (page);
      return items;
    },
    createField: (t, field) => request(`${base(t)}/fields`, 'POST', field),
    async find(t, identity) {
      const data = await request(`${base(t)}/records/search?page_size=2`, 'POST', { field_names: MANAGED_FIELDS, filter: { conjunction: 'and', conditions: [{ field_name: '计划编号', operator: 'is', value: [identity] }] } });
      if (!Array.isArray(data?.items)) throw fail('飞书未返回有效记录列表', { status: 502 });
      if (data.has_more || data.items.length > 1) throw fail('飞书中存在重复计划编号，请先在表格合并重复行后重试。', { conflict: true });
      return data.items[0] || null;
    },
    async get(t, id) { return (await request(`${base(t)}/records/${encodeURIComponent(id)}`))?.record; },
    async create(t, fields, key) { return (await request(`${base(t)}/records?client_token=${encodeURIComponent(key)}`, 'POST', { fields }))?.record; },
    async update(t, id, fields) { return (await request(`${base(t)}/records/${encodeURIComponent(id)}`, 'PUT', { fields }))?.record; },
  };
}
