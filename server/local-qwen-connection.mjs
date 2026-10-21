import { z } from 'zod';

export const defaultLocalQwen = { enabled: false, engine: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: '' };
export function localQwenBase(value) {
  // Validate the original spelling before URL normalization (no integer, hex,
  // octal, DNS rebinding, credentials, query, fragment or alternate path forms).
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{3,4})\/v1\/?$/.exec(value);
  if (!match || Number(match[2]) < 1024 || Number(match[2]) > 65535) throw Object.assign(Error('本地模型地址只能是 http://127.0.0.1:端口/v1 或 http://[::1]:端口/v1；端口须为 1024–65535。不接受远程地址、代理路径或跳转。'), { status: 400, noCharge: true });
  return `http://${match[1] === 'localhost' ? '127.0.0.1' : match[1]}:${match[2]}/v1`;
}
export const localQwenConnectionSchema = z.object({
  enabled: z.boolean(), engine: z.enum(['ollama', 'openai']),
  baseUrl: z.string().trim().max(200).transform(localQwenBase),
  model: z.string().trim().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, '请填写本机服务中的完整模型 ID').refine(value => !/cloud/i.test(value), '此入口仅供本地模型，不接受 cloud 模型'),
}).strict();
export const localQwenCredentialSchema = z.object({ apiKey: z.string().trim().min(1).max(512).regex(/^[\x21-\x7e]+$/, '密钥不能含空白或控制字符') }).strict();
export function localQwenConnection(value) { return value ? localQwenConnectionSchema.parse(value) : { ...defaultLocalQwen }; }
