export type DouyinAuthorizationResult = { callbackUrl?: string; cancelled?: boolean; error?: string };
export type ExternalMCPArgs = {platform:'xiaohongshu'|'douyin';sessionToken:string;accountId?:string};
export type ExternalMCPStatus = {platform:'xiaohongshu'|'douyin';accountId:string;endpoint:string;status:'stopped'|'starting'|'running'|'failed'|'stopping';managed:boolean;ready:boolean;programSaved:boolean;loginDataPresent:boolean;loginDataUpdatedAt?:string;note:string};
export type CapturedComment = { text: string; platformCommentId?: string; parentCommentId?: string; commentAt?: string; likes: number | null; timeLabel: string; isReply: boolean };
export type CapturedMetrics = {platform:'douyin'|'xiaohongshu';itemId:string;capturedAt:string;metrics:import('./types').MetricSnapshot['metrics']};
export type PublicationReceipt = {platform:'douyin'|'xiaohongshu';itemId:string;url:string;submittedAt:string};
export type CommentCaptureResult = { rows?: CapturedComment[]; metrics?: CapturedMetrics | null; sourceUrl?: string; platform?: 'douyin' | 'xiaohongshu'; mode?: 'page' | 'selection'; limited?: boolean; skipped?: number; error?: string; cancelled?: boolean; includeReplies?: boolean; rounds?: number; stopReason?: string; notice?: string };
declare global {
  interface Window {
    studioDesktop?: {
      setTaskState?: (value: {active: number; paused: number; connected?: boolean}) => void;
      notifyWork?: (args: { notificationId: string; sessionToken: string; sound: boolean }) => Promise<{ delivered: boolean }>;
      onWorkNotification?: (callback: (value: { notificationId: string }) => void) => () => void;
      onPrepareQuit?: (callback: () => void | Promise<void>) => () => void;
      confirmTaskSave?: (value: {saved: boolean}) => Promise<void>;
      documentParserStatus: (args:{sessionToken:string})=>Promise<import('./document-parser-types').DocumentParserStatus>;
      configureDocumentParser: (args:{sessionToken:string})=>Promise<import('./document-parser-types').DocumentParserStatus>;
      parseDocument: (args:{sessionToken:string;requestId:string;name:string;base64:string})=>Promise<import('./document-parser-types').DocumentParseResult>;
      cancelDocumentParse: (args:{sessionToken:string;requestId:string})=>Promise<unknown>;
      stopExternalMCP: (args: ExternalMCPArgs) => Promise<{note?: string; error?: string}>;
      startExternalMCP: (args: ExternalMCPArgs & {chooseProgram?:boolean}) => Promise<{endpoint?: string; token?: string; ready?: boolean; cancelled?: boolean; note?: string; error?: string;accountId?:string}>;
      getExternalMCPStatus: (args: ExternalMCPArgs) => Promise<{items?:ExternalMCPStatus[];error?:string}>;
      restartMCP: () => Promise<{ok?: boolean; note?: string; error?: string}>;
      openPlatformLogin: (args: {platform: 'xiaohongshu' | 'douyin'; sessionToken: string}) => Promise<{closed?: boolean; cancelled?: boolean; note?: string; error?: string}>;
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
