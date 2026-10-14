import type { AppearancePreferences, State } from '../src/types';
import type { ZodType } from 'zod';
export const appearanceSchema: ZodType<AppearancePreferences>;
export function appearanceOf(state: Pick<State, 'appearance'>): AppearancePreferences;
export function saveAppearance(state: State, input: unknown): AppearancePreferences;
