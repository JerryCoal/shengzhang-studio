import type { ZodType } from 'zod';

export type BriefImportField = 'name' | 'brand' | 'product' | 'goal' | 'audience' | 'sellingPoints' | 'facts' | 'requirements';
export interface BriefImportInput { sourceName: string; text: string }
export interface BriefImportCandidate { field: BriefImportField; value: string; evidence: string[] }
export interface BriefImportResult { fields: BriefImportCandidate[]; warnings: string[] }
export const BRIEF_IMPORT_MAX_CHARS: number;
export const BRIEF_IMPORT_MAX_BYTES: number;
export const BRIEF_IMPORT_FIELD_LABELS: Readonly<Record<BriefImportField, string>>;
export const BRIEF_IMPORT_FIELD_LIMITS: Readonly<Record<BriefImportField, number>>;
export const BRIEF_IMPORT_FIELDS: readonly BriefImportField[];
export const BRIEF_IMPORT_REVIEW_WARNING: string;
export const briefImportInputSchema: ZodType<BriefImportInput>;
export const briefImportInstructions: string;
export const briefImportDefinition: {
  instructions: string;
  schema: Record<string, unknown>;
  validate(value: unknown, payload: BriefImportInput): BriefImportResult;
};
export const briefImportConfig: Readonly<{
  id: 'brief-import'; label: string; model: 'deepseek-v4-pro'; provider: 'deepseek';
  inputPrice: number; outputPrice: number; priceNote: string; description: string;
  maxTokens: 7000; thinking: false; effort: 'low';
}>;
export function validateBriefImport(value: unknown, payload: BriefImportInput): BriefImportResult;
