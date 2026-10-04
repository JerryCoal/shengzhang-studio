// Shared by desktop storage, browser storage and the stateless web relay.
// Keep old receipts for reconciliation, but never resume a legacy publish job.
export function disableAutomaticPublishing(state) {
  for (const account of state.accounts || []) account.autoPublish = false;
  for (const project of state.projects || []) for (const record of project.publications || []) {
    const previous = record.automation;
    if (!previous || previous.status === 'disabled') continue;
    if (!['published', 'cancelled'].includes(record.status)) {
      record.manualReviewRequired = !!previous.itemId || ['submitting', 'submitted', 'uncertain'].includes(previous.status);
      record.manualPublishNote = record.manualReviewRequired
        ? '旧版任务可能已提交到抖音。请先在平台核对，已发布则登记原作品链接，避免重复上传。'
        : '旧版自动发布已关闭，素材已保留。请导出后在平台手动发布。';
    }
    record.automation = { ...previous, previousStatus: previous.status, status: 'disabled', autoComments: false, nextPollAt: 0 };
  }
  return state;
}
