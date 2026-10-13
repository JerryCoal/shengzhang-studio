import type { ContentRule, CopyMatch } from '../src/types';
export function actionOf(rule: ContentRule): 'replace' | 'rewrite' | 'allow' | 'semantic';
export function scanText(text: string, rules: ContentRule[], field?: string): CopyMatch[];
export function scanCopy(input: object, rules: ContentRule[]): CopyMatch[];
export function copyFields(input: object): Record<string, string>;
export function applyFixed(text: string, matches: CopyMatch[]): string;
export function parseRules(text: string, format?: string): ContentRule[];
export function serializeRules(rules: ContentRule[], format?: string): string;
export function mergeRules(existing: ContentRule[], incoming: ContentRule[]): { rules: ContentRule[]; added: number; skipped: number };
