import type { ZodType } from 'zod';
export type QwenRegion = 'cn-beijing' | 'ap-southeast-1' | 'us-east-1' | 'cn-hongkong' | 'ap-northeast-1' | 'eu-central-1';
export type QwenConnectionConfig = { region: QwenRegion; workspaceId: string };
export const QWEN_CONNECTION_OPTIONS: { id: QwenRegion; label: string; host?: string; requiresWorkspace?: boolean }[];
export const qwenConnectionSchema: ZodType<QwenConnectionConfig>;
export function qwenConnection(value?: QwenConnectionConfig): QwenConnectionConfig & { label: string; baseUrl: string; ragSupported: boolean };
export function normalizeQwenKey(input: unknown): string;
export function isQwenUrl(value: string): boolean;
export function qwenRequestUrl(value: string, connection?: QwenConnectionConfig): string;
