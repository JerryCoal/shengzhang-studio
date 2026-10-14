// Fixed Beijing endpoint: https://help.aliyun.com/zh/model-studio/base-url
// Price/limits: https://help.aliyun.com/zh/model-studio/text-embedding-v4
export const QWEN_EMBEDDING_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
export const QWEN_EMBEDDING_MODEL = 'text-embedding-v4';
export const QWEN_EMBEDDING_DIMENSIONS = 512;
export const QWEN_EMBEDDING_BATCH_LIMIT = 10;
export const QWEN_EMBEDDING_MAX_TEXT_BYTES = 8192;
export const QWEN_EMBEDDING_CNY_PER_MILLION = 0.5;
const MAX_RESPONSE_BYTES = 4_000_000;
const TIMEOUT_MS = 30_000;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const remoteError = (message, extra = {}) => Object.assign(new Error(message), { status: 502, embeddingError: true, ...extra });
const amount = tokens => Number((tokens * QWEN_EMBEDDING_CNY_PER_MILLION / 1_000_000).toFixed(10));

// UTF-8 bytes bound token counts conservatively; this is an estimate, not a tokenizer.
export function estimateTokens(texts) {
  const input = typeof texts === 'string' ? [texts] : texts;
  if (!Array.isArray(input) || input.some(text => typeof text !== 'string')) fail('向量输入必须为文字');
  return input.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
}
export function estimateCny(texts) { return amount(estimateTokens(texts)); }
export function validVector(vector) {
  if (!Array.isArray(vector) || vector.length !== QWEN_EMBEDDING_DIMENSIONS) return false;
  let norm = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) return false;
    norm += value * value;
  }
  return Number.isFinite(norm) && norm > 0;
}
async function boundedJSON(response) {
  if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw remoteError('Qwen 向量响应超过大小限制，请核对账单。');
  }
  const buffers = []; let length = 0;
  for await (const bytes of response.body || []) {
    length += bytes.length;
    if (length > MAX_RESPONSE_BYTES) throw remoteError('Qwen 向量响应超过大小限制，请核对账单。');
    buffers.push(Buffer.from(bytes));
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { throw remoteError('Qwen 向量响应无法读取，请核对账单。'); }
}
function responseTokens(usage) {
  const tokens = usage?.total_tokens ?? usage?.prompt_tokens;
  return Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 10_000_000 ? tokens : null;
}

/** One request only. onUsage is awaited once, outside the transport catch: ledger errors must propagate. */
export async function embedTexts(texts, { key, fetcher = fetch, onUsage } = {}) {
  if (!Array.isArray(texts) || !texts.length || texts.length > QWEN_EMBEDDING_BATCH_LIMIT) fail('每批向量请求需要 1–10 段文字');
  if (texts.some(text => typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > QWEN_EMBEDDING_MAX_TEXT_BYTES)) fail('向量文字为空或超过单段长度限制');
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key)) fail('请先填写有效的百炼北京地域 API 密钥');
  const estimatedCny = estimateCny(texts);
  let vectors, tokens = null, failure, noCharge = false;
  try {
    const response = await fetcher(QWEN_EMBEDDING_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: QWEN_EMBEDDING_MODEL, input: texts, dimensions: QWEN_EMBEDDING_DIMENSIONS, encoding_format: 'float' }),
    });
    if (!response.ok) {
      const code = response.status;
      noCharge = code >= 400 && code < 500 && code !== 408;
      await response.body?.cancel().catch(() => {});
      const descriptions = { 400: '文字或模型参数不被支持', 401: '请检查北京地域 API 密钥', 402: '请检查账户余额', 403: '请检查模型权限或余额', 404: '请确认向量模型已开通', 429: '请求频率受限，请稍后再试' };
      throw remoteError(`Qwen 向量请求未完成：${descriptions[code] || '服务暂时不可用'}（HTTP ${code}）。`, { noCharge });
    }
    const result = await boundedJSON(response);
    tokens = responseTokens(result.usage);
    if (result.model !== undefined && result.model !== QWEN_EMBEDDING_MODEL) throw remoteError('Qwen 返回的向量模型不匹配，请核对账单。');
    if (!Array.isArray(result.data) || result.data.length !== texts.length) throw remoteError('Qwen 返回的向量数量不匹配，请核对账单。');
    vectors = Array(texts.length); const indices = new Set();
    for (const row of result.data) {
      if (!row || !Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length || indices.has(row.index) || !validVector(row.embedding)) throw remoteError('Qwen 返回的向量格式不完整，请核对账单。');
      indices.add(row.index); vectors[row.index] = [...row.embedding];
    }
  } catch (error) {
    failure = error?.embeddingError ? error : remoteError('Qwen 向量连接未完成；不会自动重试，请核对网络及账单。');
  }
  const usage = noCharge
    ? { tokens: 0, estimated: false, amountCny: 0, status: 'failed' }
    : { tokens, estimated: tokens === null, amountCny: tokens === null ? estimatedCny : amount(tokens), status: failure ? (tokens === null ? 'uncertain' : 'failed') : 'completed' };
  if (onUsage) await onUsage(usage);
  if (failure) throw failure;
  return { vectors, usage };
}
