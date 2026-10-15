import type { Asset, Publication } from '../src/types';
export const CREATOR_URLS: Record<import('./platform-catalog.mjs').MatrixPlatform, string>;
export function safeFilename(value: unknown, fallback?: string): string;
export function exportDetails(content: Asset | Publication): { platform: import('./platform-catalog.mjs').MatrixPlatform; label: string; revision: number; stem: string; mediaName: string; extension: string; filename: string; creatorUrl: string; warnings: string[] };
export function contentArchive(content: Asset | Publication, options: { type: 'blob' }): Promise<{ data: Blob; filename: string }>;
export function contentArchive(content: Asset | Publication, options: { type: 'base64' }): Promise<{ data: string; filename: string }>;
