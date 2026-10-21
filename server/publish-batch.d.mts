import type { State, Project, Asset, Publication, Account, Platform } from '../src/types';
export type ReviewedPublication = { projectId: string; assetId: string; publicationId?: string; accountId: string; platform: Platform; expectedRevision: number; originalTitle: string; originalBody: string; originalMime: string };
export type BatchItem = { id: string; projectId: string; publicationId: string; platform: Platform; mode: 'builtin' | 'external' };
export type BatchUpdate = { status: 'running' | 'returned' | 'review'; note: string };
export function runPublicationBatch<T extends BatchItem>(items: T[], actions: { submit: (item: T) => Promise<{ note?: string }>; update?: (item: T, value: BatchUpdate) => Promise<void> | void; checkpoint?: () => Promise<void> }): Promise<({ id: string } & BatchUpdate)[]>;
export function assertReviewedPublication(state: State, review: ReviewedPublication): { project: Project; content: Asset | Publication; account: Account; existing?: Publication };
