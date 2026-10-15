export type CommentSource = { platform: import('../server/platform-catalog.mjs').MatrixPlatform; itemId: string | null; url: string; canonical: string | null };
export function commentSource(value: unknown): CommentSource;
export function sameCommentWork(expected: CommentSource, actual: CommentSource): boolean;
