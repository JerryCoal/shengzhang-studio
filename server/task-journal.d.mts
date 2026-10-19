export type TaskJournalEntry = import('../src/components/BackgroundTasks').BackgroundTask;
export function taskJournal(state: unknown): TaskJournalEntry[];
export function saveTaskJournal(state: unknown, id: string, input: unknown): unknown;
export function removeTaskJournal(state: unknown, id: string): { ok: true };
export function mountTaskJournalRoutes(app: unknown, store: unknown): void;
