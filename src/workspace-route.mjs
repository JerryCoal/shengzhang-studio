const pages = new Set(['controller', 'tasks', 'accounts', 'materials', 'dashboard', 'projects', 'corpus', 'trends', 'strategy', 'studio', 'publish', 'comments', 'analytics', 'planning', 'settings', 'help', 'inspiration', 'xiaohongshu-agent', 'douyin-agent', 'instagram-agent', 'youtube-agent', 'analysis-agent']);
const keys = ['assetId', 'publicationId', 'accountId', 'tab', 'planId', 'taskId', 'runId', 'artifactId', 'artifactVersion', 'eventId'];
// Old task bookmarks and notifications now select a task inside the controller.
// Other legacy pages remain addressable for saved drafts and paused work.
export function resolveWorkspacePage(page) { return page === 'tasks' || !pages.has(page) ? 'controller' : page; }
export function readWorkspaceRoute(hash = '') {
  const [name, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query), target = {};
  for (const key of keys) if (params.get(key)) target[key] = params.get(key).slice(0, 200);
  return { page: resolveWorkspacePage(name), projectId: (params.get('project') || '').slice(0, 200), target };
}
export function writeWorkspaceRoute(page, projectId = '', target = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set('project', projectId);
  for (const key of keys) if (target[key]) params.set(key, String(target[key]));
  // Creation requirements and private reference text stay in the workspace, never in a URL.
  return `#${resolveWorkspacePage(page)}${params.size ? '?' + params.toString() : ''}`;
}
