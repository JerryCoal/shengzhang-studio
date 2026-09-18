import { z } from 'zod';

// Official Ark image API and tutorial verified 2026-09-15. All presets use 9:16,
// 3,686,400 pixels, within the documented limits for these four model families.
export const SEEDREAM_MODELS = {
  '5.0-lite': { label: 'Seedream 5.0 Lite', model: 'doubao-seedream-5-0-lite-260128' },
  '5.0-pro': { label: 'Seedream 5.0 Pro', model: 'doubao-seedream-5-0-pro-260628' },
  '4.5': { label: 'Seedream 4.5', model: 'doubao-seedream-4-5-251128' },
  '4.0': { label: 'Seedream 4.0', model: 'doubao-seedream-4-0-250828' },
};
export const SEEDREAM_SIZE = '1440x2560';
export const SEEDREAM_COVER_SIZE = '1728x2304';
export const defaultSeedream = { family: '5.0-lite', model: SEEDREAM_MODELS['5.0-lite'].model, reservationUsd: 0.1, imagePriceUsd: 0 };
export const seedreamSettingsSchema = z.object({
  family: z.enum(['5.0-lite', '5.0-pro', '4.5', '4.0']),
  model: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  reservationUsd: z.number().min(.01).max(100),
  imagePriceUsd: z.number().min(0).max(100),
}).strict().superRefine((value, context) => {
  // Endpoint IDs hide the family, so users explicitly choose it. Known model IDs
  // cannot be paired with an incompatible family (Pro does not accept group mode).
  if (!value.model.startsWith('ep-') && !value.model.startsWith('doubao-seedream-')) context.addIssue({ code: 'custom', message: '请填写 Seedream 模型 ID 或 ep- 接入点' });
  const family = Object.entries(SEEDREAM_MODELS).find(([, v]) => v.model === value.model)?.[0];
  if (family && family !== value.family) context.addIssue({ code: 'custom', message: '模型 ID 与所选 Seedream 系列不一致' });
});
export const seedreamConnectionSchema = z.object({ settings: seedreamSettingsSchema, apiKey: z.string().trim().min(8).max(512).regex(/^[A-Za-z0-9_.-]+$/).optional() }).strict();
