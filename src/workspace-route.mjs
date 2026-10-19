const pages = new Set(['dashboard', 'projects', 'corpus', 'trends', 'strategy', 'studio', 'publish', 'comments', 'analytics', 'planning', 'settings', 'help', 'inspiration', 'xiaohongshu-agent', 'douyin-agent', 'instagram-agent', 'youtube-agent', 'analysis-agent']);
const keys = ['assetId', 'publicationId', 'accountId', 'tab'];
export function readWorkspaceRoute(hash = '') {
  const [name, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query), target = {};
  for (const key of keys) if (params.get(key)) target[key] = params.get(key).slice(0, 200);
  return { page: pages.has(name) ? name : 'dashboard', projectId: (params.get('project') || '').slice(0, 200), target };
}
export function writeWorkspaceRoute(page, projectId = '', target = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set('project', projectId);
  for (const key of keys) if (target[key]) params.set(key, String(target[key]));
  // Creation requirements and private reference text stay in the workspace, never in a URL.
  return `#${pages.has(page) ? page : 'dashboard'}${params.size ? '?' + params.toString() : ''}`;
}
