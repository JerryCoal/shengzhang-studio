export type MatrixPlatform = 'xiaohongshu' | 'douyin' | 'tiktok' | 'youtube' | 'instagram';
export const PLATFORM_IDS: MatrixPlatform[];
export const PLATFORM_NAMES: Record<MatrixPlatform, string>;
export const CREATOR_URLS: Record<MatrixPlatform, string>;
export const PUBLISH_LIMITS: Record<MatrixPlatform, { title: number; body: number }>;
export const PLATFORM_WORK: Record<MatrixPlatform, { key: string; kind: 'image' | 'video'; name: string; description: string; instruction: string }>;
export function hasBuiltinPageAssistant(platform: string): platform is 'xiaohongshu' | 'douyin';
