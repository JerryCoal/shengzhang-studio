// Orchestration only: every item retains the normal authenticated publication
// endpoint, its own reviewed payload and durable delivery lock. Never retry here.
export async function runPublicationBatch(items, { submit, update = () => {}, checkpoint = async () => {} }) {
  if (!Array.isArray(items) || !items.length || items.length > 20 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('每批请选择 1–20 条不重复的发布内容');
  const groups = new Map();
  for (const item of items) {
    if (!item.id || !item.platform || !item.publicationId || !item.projectId) throw new Error('发布条目缺少明确的项目、平台或记录编号');
    const key = item.mode === 'builtin' ? 'desktop-assistant' : item.platform;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item);
  }
  // A checkpoint is a barrier before dispatch, never a reason to replay a call.
  await checkpoint();
  const results = new Map();
  await Promise.all([...groups.values()].map(async rows => {
    for (const item of rows) {
      try {
        await update(item, { status: 'running', note: '正在提交；请勿在其他窗口重复发布' });
        const result = await submit(item);
        const value = { status: 'returned', note: result?.note || '请求已返回，请核对平台作品与审核状态' };
        results.set(item.id, value); await update(item, value);
      } catch (error) {
        const value = { status: 'review', note: error instanceof Error ? error.message : '结果待核对；不会自动重试' };
        results.set(item.id, value); await update(item, value);
      }
    }
  }));
  return items.map(item => ({ id: item.id, ...results.get(item.id) }));
}

export function assertReviewedPublication(state, review) {
  const project = state.projects.find(item => item.id === review.projectId);
  if (!project || project.sample) throw new Error('原项目已不存在或为示例，需重新选择');
  const account = state.accounts.find(item => item.id === review.accountId);
  const content = review.publicationId ? project.publications.find(item => item.id === review.publicationId) : project.assets.find(item => item.id === review.assetId);
  if (!content || !account || account.platform !== review.platform || (content.platform || content.channel) !== review.platform) throw new Error('作品或账号归属已变化，请重新核对');
  if ((content.assetRevision ?? content.revision) !== review.expectedRevision || content.title !== review.originalTitle || content.body !== review.originalBody || content.mime !== review.originalMime) throw new Error('核对后内容已修改，请重新检查这一条');
  if (review.publicationId) {
    if (content.accountId !== review.accountId || !['scheduled', 'exported'].includes(content.status) || content.sample || content.manualReviewRequired || content.delivery && content.delivery.phase !== 'reset') throw new Error('该记录已处理或结果待核对，不会再次提交');
  } else if (content.status !== 'ready' || !content.mediaData) throw new Error('当前版本成品尚未就绪，请重新制作');
  const existing = review.publicationId ? content : project.publications.find(item => item.assetId === content.id && item.assetRevision === review.expectedRevision && item.accountId === review.accountId && item.status !== 'cancelled');
  if (existing && (existing.sample || !['scheduled', 'exported'].includes(existing.status) || existing.manualReviewRequired || existing.delivery && existing.delivery.phase !== 'reset')) throw new Error('这份内容已有发布或提交记录，请先核对平台结果');
  return { project, content, account, existing };
}
