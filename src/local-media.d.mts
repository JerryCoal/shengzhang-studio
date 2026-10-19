export type LocalMediaKind = 'reference' | 'audio' | 'image-asset' | 'video-asset';
export function localMediaOptions(kind: LocalMediaKind): { mimes: string[]; maxBytes: number; label: string; accept: string };
export function validateLocalMediaFile(file: { size: number; type: string; name: string }, kind: LocalMediaKind, header?: ArrayBuffer): string;
