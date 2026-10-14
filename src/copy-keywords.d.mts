import type { Project } from './types';
export function projectKeywords(project?: Project, now?: number): string[];
export function splitCopyKeywords(text: string, terms: string[]): { text: string; keyword: boolean }[];
