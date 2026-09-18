import { readBounded, integrationError } from './integration-http.mjs';
import { seedreamSettingsSchema, SEEDREAM_SIZE, SEEDREAM_COVER_SIZE } from './seedream-config.mjs';

const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
export function validateSeedreamReferences(references) {
  if (!Array.isArray(references) || references.length > 2 || references.some(v => typeof v !== 'string' || v.length > 12_000_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v))) throw integrationError('Seedream 参考图需为本地 PNG、JPG 或 WebP 图片，每张不超过 9 MB。', 400, { noCharge: true });
}
export function seedreamCost(usage, settings) {
  const count = usage?.generated_images;
  return Number.isInteger(count) && count >= 0 && count <= 1 && (count === 0 || settings.imagePriceUsd > 0) ? count * settings.imagePriceUsd : null;
}
export async function generateSeedreamKeyframe({ apiKey, prompt, references = [], settings, size = SEEDREAM_SIZE }, fetcher = fetch) {
  settings = seedreamSettingsSchema.parse(settings); validateSeedreamReferences(references);
  if (![SEEDREAM_SIZE, SEEDREAM_COVER_SIZE].includes(size)) throw integrationError('不支持的图片尺寸', 400, { noCharge: true });
  const body = { model: settings.model, prompt, size, response_format: 'b64_json', watermark: true,
    ...(references.length ? { image: references } : {}),
    ...(settings.family === '5.0-pro' ? {} : { sequential_image_generation: 'disabled', stream: false }),
  };
  let response;
  try { response = await fetcher(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(300000) }); }
  catch { throw integrationError('Seedream 连接中断或超时，请在火山方舟核对生成记录；不会自动重复提交。'); }
  if (!response.ok) {
    // Never reflect upstream text: it can contain a key, prompt or reference image.
    await response.body?.cancel();
    const message = { 400: '请求参数未通过检查，请核对模型系列、接入点和参考图', 401: 'API Key 无效或已过期，请重新填写火山方舟 API Key', 402: '账户余额不足，请检查火山账户账单', 403: '无模型访问权限，请在火山方舟开通所选模型并检查密钥权限', 404: '模型或接入点不存在，请从北京区域控制台复制正确 ID', 429: '请求频率或配额受限，请检查火山方舟配额并稍后手动重试' }[response.status] || '服务暂时不可用，请核对控制台任务与账单';
    throw integrationError(`Seedream：${message}（HTTP ${response.status}）。`, 502, { noCharge: response.status >= 400 && response.status < 500 });
  }
  let output;
  try { output = JSON.parse((await readBounded(response, 16_000_000)).toString('utf8')); }
  catch { throw integrationError('Seedream 未返回完整图片，请核对火山方舟生成记录；不会自动重试。'); }
  const encoded = output.data?.[0]?.b64_json;
  const invalid = () => integrationError('Seedream 未返回可保存的 PNG/JPG 图片，请核对火山方舟生成记录。', 502, { usage: output.usage, noCharge: output.usage?.generated_images === 0 });
  if (output.error || output.data?.length !== 1 || output.data[0].error || typeof encoded !== 'string' || encoded.length > 12_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid();
  const bytes = Buffer.from(encoded, 'base64');
  const mime = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9' ? 'image/jpeg' : '';
  if (!mime) throw invalid();
  return { mediaData: `data:${mime};base64,${encoded}`, usage: output.usage, size };
}
