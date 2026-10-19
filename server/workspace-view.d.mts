import type { Asset, Project, Publication } from '../src/types';
export function assetAccountId(asset: Asset): string;
export function assetPublicationRecords(project: Project, asset: Asset, accountId?: string): Publication[];
export function scopedPublications(project: Project, accountId?: string): Publication[];
