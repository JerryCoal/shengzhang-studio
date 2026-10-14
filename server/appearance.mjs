import { z } from 'zod';

const fontScaleSchema = z.union([z.literal(1), z.literal(1.125), z.literal(1.25), z.literal(1.375)]);
export const appearanceSchema = z.object({ fontScale: fontScaleSchema, emphasize: z.boolean() }).strict();

// Old workspaces can omit preferences; damaged display values must not prevent login.
export function appearanceOf(state) {
  const saved = state.appearance;
  return {
    fontScale: fontScaleSchema.safeParse(saved?.fontScale).success ? saved.fontScale : 1,
    emphasize: typeof saved?.emphasize === 'boolean' ? saved.emphasize : false,
  };
}

export function saveAppearance(state, input) {
  const appearance = appearanceSchema.parse(input);
  state.appearance = appearance;
  return appearance;
}
