export function assetAccountId(asset) {
  return asset.contentBrief?.accountId || asset.creationTrace?.accounts?.find(a => a.platform === asset.channel)?.accountId || '';
}
export function assetPublicationRecords(project, asset, accountId = '') {
  const target = accountId || assetAccountId(asset);
  // An unassigned legacy asset cannot be considered complete for every account.
  if (!target) return [];
  return project.publications.filter(p => p.assetId === asset.id && p.assetRevision === asset.revision && p.accountId === target && p.status !== 'cancelled');
}
export function scopedPublications(project, accountId = '') {
  return project.publications.filter(p => !accountId || p.accountId === accountId);
}
