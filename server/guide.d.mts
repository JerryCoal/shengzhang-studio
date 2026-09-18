import type { State, Project, Asset, GuideState, Page } from '../src/types';
export function guideProgress(state: State): { guide: GuideState; project?: Project; asset?: Asset; steps: boolean[]; step: number; complete: boolean };
export function updateGuide(state: State, input: unknown): GuideState;
export function nextProjectAction(project?: Project): { page: Page; title: string; detail: string };
