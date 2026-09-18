import type { ZodType } from 'zod';
import type { SeedreamSettings } from '../src/types';
export const SEEDREAM_MODELS: Record<SeedreamSettings['family'], { label: string; model: string }>;
export const SEEDREAM_SIZE: string;
export const defaultSeedream: SeedreamSettings;
export const seedreamSettingsSchema: ZodType<SeedreamSettings>;
export const seedreamConnectionSchema: ZodType<{ settings: SeedreamSettings; apiKey?: string }>;
