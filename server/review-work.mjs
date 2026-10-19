import { z } from 'zod';
import { commentSource } from '../desktop/comment-source.mjs';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function registerReviewWork(state, project, input) {
  const data = z.object({ accountId: z.string().min(1).max(100), url: z.string().trim().min(1).max(8192), title: z.string().trim().min(1).max(200), publishedAt: z.string().datetime({ offset: true }).nullable().optional(), confirmed: z.literal(true) }).strict().parse(input);
  const account = state.accounts.find(a => a.id === data.accountId);
  if (!account) fail('目标账号不存在，请重新选择', 409);
  let source;
  try { source = commentSource(data.url); }
  catch (error) { fail(error.message); }
  if (source.platform !== account.platform) fail('作品链接与所选账号的平台不一致');
  if (!source.itemId) fail('请先在浏览器打开短链接，再复制完整作品地址，避免关联到错误作品');
  if (data.publishedAt && Date.parse(data.publishedAt) > Date.now() + 300000) fail('已发布作品的时间不能在未来');
  const existing = project.publications.find(row => {
    if (row.platform === source.platform && row.platformItemId === source.itemId) return true;
    try { const parsed = commentSource(row.url); return parsed.platform === source.platform && parsed.itemId === source.itemId; } catch { return false; }
  });
  if (existing) {
    if (existing.accountId !== account.id) fail('这篇作品已归属另一个账号，请先核对现有记录；不会串用指标', 409);
    if (existing.status !== 'published') fail('已有该作品的发布待办，请先核对并登记现有记录', 409);
    return existing;
  }
  if (project.publications.length >= 5000) fail('本项目作品记录已达上限，请整理后再继续');
  const at = new Date().toISOString();
  const row = { id: globalThis.crypto.randomUUID(), assetId: '', assetRevision: 0, strategyId: '', accountId: account.id, accountName: account.name, platform: account.platform,
    title: data.title, body: '', mediaData: '', mime: '', scheduledAt: data.publishedAt || at, publishedAt: data.publishedAt || null, createdAt: at,
    status: 'published', url: source.url, platformItemId: source.itemId, confirmationSource: 'user-external-registration', sample: false, external: true };
  project.publications.push(row); project.revision++; project.updatedAt = at;
  return row;
}
