export type EditFields = { title: string; body: string; requirement: string; knowledgeIds: string[] };
export type EditBase = EditFields & { revision: number };
export type ContentEditInput = EditFields & { projectId: string; assetId: string; accountId: string; base: EditBase };
export type ContentEditDraft = ContentEditInput & { key: string; revision: string; updatedAt: string };
export function contentEditDraftKey(projectId: string, assetId: string, accountId?: string): string;
export function readContentEditDraft(state: object, key: string): ContentEditDraft | null;
export function saveContentEditDraft(state: object, key: string, input: { expectedRevision: string | null; draft: ContentEditInput }): ContentEditDraft;
export function removeContentEditDraft(state: object, key: string, input: { expectedRevision: string | null }): { ok: true };
export function mountContentEditDraftRoutes(app: unknown, store: unknown): void;
