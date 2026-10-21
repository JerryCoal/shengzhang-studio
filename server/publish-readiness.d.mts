import type { Account, Asset } from '../src/types';
export type PublishReadiness = { ready: boolean; code: string; message: string; nextAction: string };
export function assetPublishReadiness(asset: Pick<Asset, 'kind' | 'status' | 'revision' | 'mediaData' | 'mime'> & Partial<Pick<Asset, 'aiCover' | 'aiProduction'>>): PublishReadiness;
export function publicationAccountChoice(asset: Pick<Asset, 'channel' | 'creationTrace'> & Partial<Pick<Asset, 'contentBrief'>>, accounts: Account[]): { defaultAccountId: string; sourceAccountId: string; sourceAccountName: string; sourceAvailable: boolean };
