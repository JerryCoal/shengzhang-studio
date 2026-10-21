export type WorkspaceScope = { projectIds: string[]; accountIds: string[] };
export function normalizeWorkspaceScope(scope: WorkspaceScope | undefined, projectIds: string[], accountIds: string[], primaryProjectId: string): WorkspaceScope;
export function scopeWithPrimary(scope: WorkspaceScope, primaryProjectId: string): WorkspaceScope;
export function toggleScopeProject(scope: WorkspaceScope, projectId: string, primaryProjectId: string): WorkspaceScope;
export function toggleScopeAccount(scope: WorkspaceScope, accountId: string): WorkspaceScope;
export function scopeHasAccount(scope: WorkspaceScope | undefined, accountId: string | undefined): boolean;
