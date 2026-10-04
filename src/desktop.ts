export type DouyinAuthorizationResult = { callbackUrl?: string; cancelled?: boolean; error?: string };
declare global {
  interface Window {
    studioDesktop?: {
      openDouyinAuthorization: (url: string) => Promise<DouyinAuthorizationResult>;
      cancelDouyinAuthorization: () => Promise<void>;
    };
  }
}
export const hasDesktopAuthorization = () => typeof window.studioDesktop?.openDouyinAuthorization === 'function';
