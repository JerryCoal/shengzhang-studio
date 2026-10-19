import type { Page } from './types';
import type { WorkspaceTarget } from './context';
export function readWorkspaceRoute(hash?: string): { page: Page; projectId: string; target: WorkspaceTarget };
export function writeWorkspaceRoute(page: Page, projectId?: string, target?: WorkspaceTarget): string;
