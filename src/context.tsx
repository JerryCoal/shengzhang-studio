import { createContext, useContext } from 'react';
import type { Page, Project, Settings, State } from './types';
import type { Mutation } from './api';
import type { BackgroundControl } from './useBackgroundTasks';
export type WorkspaceTarget = { assetId?: string; publicationId?: string; accountId?: string; requirement?: string; knowledgeIds?: string[]; newContent?: boolean; tab?: string; model?: string; skillIds?: string[]; publishingNotes?: string };
export type StudioContext = {
  state: State; project: Project | undefined; settings: Settings; busy: boolean;
  go: (page: Page, projectId?: string, target?: WorkspaceTarget) => void; notify: (message: string, error?: boolean) => void;
  target: WorkspaceTarget;
  agentInput?: { model?: string; skillIds?: string[]; accountId?: string; platform?: string; knowledgeIds?: string[]; experienceIds?: string[]; referenceIds?: string[] };
  accountScope: string;
  setAccountScope: (accountId: string) => void;
  run: (work: () => Promise<unknown>) => Promise<void>;
  runBackground: (label: string, work: (control: BackgroundControl) => Promise<unknown>) => Promise<void>;
  taskPending?: boolean;
  dialogsVisible?: boolean;
  minimizeTask?: () => void;
  restoreDialogs?: () => void;
  mutate: <T = unknown>(path: string, method?: string, body?: unknown) => Promise<Mutation<T>>;
  refresh: () => Promise<void>;
  startProject: () => void;
};
export const Context = createContext<StudioContext | null>(null);
export function useStudio() { const context = useContext(Context); if (!context) throw new Error('Missing studio context'); return context; }
