const clean = (value, limit, secrets) => typeof value === 'string' && !secrets.some(secret => secret && value.includes(secret)) ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
function imageURL(value, secrets) {
  if (typeof value !== 'string' || value.length > 3000 || secrets.some(secret => secret && value.includes(secret))) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)) return '';
    if ([...url.searchParams.keys()].some(key => /token|signature|credential|password|cookie|secret|xsec|api.?key/i.test(key))) return '';
    return url.href;
  } catch { return ''; }
}
// URLs are pointers, not image evidence. No download/vision API occurs here.
export function researchImageEvidence(input, secrets = []) {
  if (!input || typeof input !== 'object') return undefined;
  const existing = input.imageEvidence && typeof input.imageEvidence === 'object' ? input.imageEvidence : {};
  const list = existing.images || input.images || input.imageList || [];
  const images = (Array.isArray(list) ? list : []).slice(0, 6).flatMap(item => {
    const row = typeof item === 'string' ? { url: item } : item && typeof item === 'object' ? item : {};
    const url = imageURL(row.url || row.urlDefault || row.urlPre, secrets), description = clean(row.description || row.alt || row.caption, 1000, secrets);
    return url || description ? [{ ...(url ? { url } : {}), ...(description ? { description } : {}) }] : [];
  });
  const analysis = clean(existing.analysis || input.imageAnalysis, 6000, secrets);
  if (!images.length && !analysis) return undefined;
  return { images, ...(analysis ? { analysis, analysisSource: 'source-provided' } : {}), status: 'not-verified' };
}
export function textOnlyImageEvidence(input) {
  const evidence = researchImageEvidence(input);
  if (!evidence) return undefined;
  return { status: 'not-verified', ...(evidence.analysis ? { analysis: evidence.analysis.slice(0, 1600), analysisSource: 'source-provided' } : {}), images: evidence.images.map(row => ({ description: row.description?.slice(0, 300) || '' })).filter(row => row.description) };
}
