// Viewing/batch scope is separate from the single project used by editors.
// An empty account list deliberately means all accounts, never a generation identity.
export function normalizeWorkspaceScope(scope, projectIds, accountIds, primaryProjectId) {
  const projects = new Set(projectIds), accounts = new Set(accountIds);
  const selectedProjects = [...new Set((scope?.projectIds || []).filter(id => projects.has(id)))];
  if (projects.has(primaryProjectId) && !selectedProjects.includes(primaryProjectId)) selectedProjects.unshift(primaryProjectId);
  return { projectIds: selectedProjects, accountIds: [...new Set((scope?.accountIds || []).filter(id => accounts.has(id)))] };
}

export function scopeWithPrimary(scope, primaryProjectId) {
  if (!primaryProjectId) return scope;
  return { ...scope, projectIds: scope.projectIds.length > 1 ? [...new Set([...scope.projectIds, primaryProjectId])] : [primaryProjectId] };
}

export function toggleScopeProject(scope, projectId, primaryProjectId) {
  if (projectId === primaryProjectId) return scope;
  return { ...scope, projectIds: scope.projectIds.includes(projectId) ? scope.projectIds.filter(id => id !== projectId) : [...scope.projectIds, projectId] };
}

export function toggleScopeAccount(scope, accountId) {
  return { ...scope, accountIds: scope.accountIds.includes(accountId) ? scope.accountIds.filter(id => id !== accountId) : [...scope.accountIds, accountId] };
}

export function scopeHasAccount(scope, accountId) {
  return !scope?.accountIds.length || scope.accountIds.includes(accountId || '');
}
