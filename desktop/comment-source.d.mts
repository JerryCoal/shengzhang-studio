export type CommentSource = { platform: 'douyin' | 'xiaohongshu'; itemId: string | null; url: string; canonical: string | null };
export function commentSource(value: unknown): CommentSource;
export function sameCommentWork(expected: CommentSource, actual: CommentSource): boolean;
