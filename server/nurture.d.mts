import type { Brief } from '../src/types';
export const NURTURE_CHANNELS: readonly ['xiaohongshu', 'douyin', 'tiktok', 'instagram'];
export function validateSceneReference(input?: unknown): string;
export function nurtureTemplate(brief: Brief): { title: string; body: string; direction: string };
