import type { State, Project, Publication } from '../src/types';
export function registerReviewWork(state: State, project: Project, input: { accountId: string; url: string; title: string; publishedAt?: string | null; confirmed: true }): Publication;
