export type LocalMCPEntry = { name: string; project: string; program?: string; url: string; managed: boolean; requirement: string };
export const LOCAL_MCP_CATALOG: Record<'xiaohongshu'|'douyin'|'instagram'|'youtube'|'tiktok', LocalMCPEntry>;
export function localMCPDeploymentGuide(platform: keyof typeof LOCAL_MCP_CATALOG): string;
