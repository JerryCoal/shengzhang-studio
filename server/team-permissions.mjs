const mutation = method => !['GET', 'HEAD', 'OPTIONS'].includes(method);
export function teamPermission(role, method, path) {
  try { path = decodeURIComponent(path).toLowerCase().replace(/\/+$/, ''); } catch { return '请求路径无效'; }
  if (role === 'admin' || !mutation(method)) return '';
  // Switching the current member's selected account is deliberately not a
  // connection-management permission. All other connection writes are admin.
  const accountSelection = /^\/api\/mcp\/[^/]+\/accounts\/[^/]+\/activate\/?$/.test(path);
  const adminOnly = path.startsWith('/api/settings/') || path.startsWith('/api/integrations/') ||
    path.startsWith('/api/team/') || path === '/api/research/settings' ||
    (path.startsWith('/api/mcp/') && !accountSelection && !/\/(check|login-status|publish-options)\/?$/.test(path));
  if (adminOnly) return '此操作需要管理员权限，请联系管理员管理密钥、成员或平台连接。';
  const publishing = /^\/api\/projects\/[^/]+\/publications(?:\/|$)/.test(path) &&
    !/\/(?:mcp\/comments(?:\/import)?|comments-sync|redfox\/(?:detail(?:\/import)?|comments(?:\/(?:import|status|reset))?))\/?$/.test(path);
  if (publishing && role !== 'publisher') return '此操作需要发布员或管理员权限；你仍可以创作和导出内容。';
  return '';
}
