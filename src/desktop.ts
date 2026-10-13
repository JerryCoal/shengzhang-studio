export type DouyinAuthorizationResult = { callbackUrl?: string; cancelled?: boolean; error?: string };
export type CapturedComment = { text: string; platformCommentId?: string; parentCommentId?: string; commentAt?: string; likes: number | null; timeLabel: string; isReply: boolean };
export type CapturedMetrics = {platform:'douyin'|'xiaohongshu';itemId:string;capturedAt:string;metrics:import('./types').MetricSnapshot['metrics']};
export type PublicationReceipt = {platform:'douyin'|'xiaohongshu';itemId:string;url:string;submittedAt:string};
export type CommentCaptureResult = { rows?: CapturedComment[]; metrics?: CapturedMetrics | null; sourceUrl?: string; platform?: 'douyin' | 'xiaohongshu'; mode?: 'page' | 'selection'; limited?: boolean; skipped?: number; error?: string; cancelled?: boolean; includeReplies?: boolean; rounds?: number; stopReason?: string; notice?: string };
declare global {
  interface Window {
    studioDesktop?: {
      resetPlatformConnections: () => Promise<void>;
      openDouyinAuthorization: (url: string) => Promise<DouyinAuthorizationResult>;
      cancelDouyinAuthorization: () => Promise<void>;
      openCommentCapture: (url: string | { url: string; limit: number; includeReplies: boolean; sessionToken?: string }) => Promise<CommentCaptureResult>;
      cancelCommentCapture: () => Promise<void>;
      openCreatorDraft: (draft: { platform: 'douyin' | 'xiaohongshu'; title: string; body: string; mime: string; mediaData: string; sessionToken?: string; projectId?:string; publicationId?:string }) => Promise<{ prepared?: boolean; uploaded?: boolean; cancelled?: boolean; error?: string; receipt?:PublicationReceipt|null; attempted?:boolean }>;
      cancelCreatorDraft: () => Promise<void>;
    };
  }
}
export const hasDesktopAuthorization = () => typeof window.studioDesktop?.openDouyinAuthorization === 'function';
export const hasDesktopCommentCapture = () => typeof window.studioDesktop?.openCommentCapture === 'function';
export const hasDesktopCreator = () => typeof window.studioDesktop?.openCreatorDraft === 'function';
export const desktopSessionToken = () => sessionStorage.getItem('studio-session') || '';
