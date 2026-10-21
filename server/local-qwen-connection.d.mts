import type { z } from 'zod';
export type LocalQwenConnection = { enabled: boolean; engine: 'ollama' | 'openai'; baseUrl: string; model: string };
export const defaultLocalQwen: LocalQwenConnection;
export const localQwenConnectionSchema: z.ZodType<LocalQwenConnection>;
export function localQwenConnection(value?: LocalQwenConnection): LocalQwenConnection;
export function localQwenBase(value: string): string;
