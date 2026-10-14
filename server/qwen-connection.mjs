import { z } from 'zod';

// Official service endpoints only. Never accept a caller-controlled base URL.
// https://help.aliyun.com/zh/model-studio/base-url
export const QWEN_CONNECTION_OPTIONS = [
  { id: 'cn-beijing', label: '北京', host: 'dashscope.aliyuncs.com' },
  { id: 'ap-southeast-1', label: '新加坡', host: 'dashscope-intl.aliyuncs.com' },
  { id: 'us-east-1', label: '美国（弗吉尼亚）', host: 'dashscope-us.aliyuncs.com' },
  { id: 'cn-hongkong', label: '中国香港', host: 'cn-hongkong.dashscope.aliyuncs.com' },
  { id: 'ap-northeast-1', label: '日本（东京）', requiresWorkspace: true },
  { id: 'eu-central-1', label: '德国（法兰克福）', requiresWorkspace: true },
];
export const qwenConnectionSchema = z.object({
  region: z.enum(QWEN_CONNECTION_OPTIONS.map(item => item.id)),
  workspaceId: z.string().trim().toLowerCase().max(63).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?$/, '业务空间 ID 只能包含字母、数字和连字符，请勿填写网址或 API 密钥').refine(value => !/^(?:sk-|st-|ltai)/i.test(value), '请填写业务空间 ID，不要把密钥粘贴到业务空间输入框').default(''),
}).strict().superRefine((value, ctx) => {
  if (!value.workspaceId && QWEN_CONNECTION_OPTIONS.find(item => item.id === value.region).requiresWorkspace) ctx.addIssue({ code: 'custom', path: ['workspaceId'], message: '此地域需要填写百炼业务空间 ID' });
});
export function qwenConnection(value) {
  const saved = qwenConnectionSchema.parse(value || { region: 'cn-beijing', workspaceId: '' });
  const option = QWEN_CONNECTION_OPTIONS.find(item => item.id === saved.region);
  const host = saved.workspaceId ? `${saved.workspaceId}.${saved.region}.maas.aliyuncs.com` : option.host;
  return { ...saved, label: option.label, baseUrl: `https://${host}/compatible-mode/v1`, ragSupported: saved.region === 'cn-beijing' };
}

export function normalizeQwenKey(input) {
  let value = typeof input === 'string' ? input.trim() : '';
  if (/^Bearer\s+/i.test(value)) value = value.replace(/^Bearer\s+/i, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  if (/^LTAI/i.test(value)) throw Object.assign(new Error('这里需要百炼「API Key」页面复制的密钥，不是阿里云 AccessKey ID。请打开下方的 API Key 创建指引。'), { status: 400 });
  if (!/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(value) || /^[*._-]+$/.test(value)) throw Object.assign(new Error('请粘贴完整的百炼 API Key（16–4096 位），不要包含空格、换行、网址或已打码的星号。保存只检查输入格式，是否可用请再点「检查连接」。'), { status: 400 });
  return value;
}

export function isQwenUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      QWEN_CONNECTION_OPTIONS.some(item => url.hostname === item.host || new RegExp(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.${item.id}\\.maas\\.aliyuncs\\.com$`).test(url.hostname)) &&
      /^\/compatible-mode\/v1\/(?:models|chat\/completions|embeddings)$/.test(url.pathname);
  } catch { return false; }
}

export function qwenRequestUrl(value, connection) {
  const defaultBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (!String(value).startsWith(defaultBase + '/') || !isQwenUrl(value)) return value;
  return qwenConnection(connection).baseUrl + String(value).slice(defaultBase.length);
}
