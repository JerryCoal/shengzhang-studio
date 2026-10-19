import type { BackgroundTask } from './components/BackgroundTasks';
import type { Page, Project } from './types';

const platformPages: Record<string, Page> = { xiaohongshu: 'xiaohongshu-agent', douyin: 'douyin-agent', instagram: 'instagram-agent', youtube: 'youtube-agent' };
const working = ['generating', 'generating-frame', 'submitting-video', 'generating-video'];
export function projectMediaTasks(projects: Project[]): BackgroundTask[] {
  const rows: BackgroundTask[] = [];
  for (const project of projects) for (const asset of project.assets) {
    const page = platformPages[asset.channel] || 'studio';
    const common = { page, projectId: project.id, projectName: project.brief.name, workspaceKey: `${page}:${project.id}`, externallyManaged: true, accountId: asset.contentBrief?.accountId || asset.creationTrace?.accounts?.[0]?.accountId, target: { assetId: asset.id, accountId: asset.contentBrief?.accountId || asset.creationTrace?.accounts?.[0]?.accountId, tab: 'produce' }, retained: true, startedAt: Date.parse(project.updatedAt) || Date.now(), updatedAt: Date.parse(project.updatedAt) || Date.now() };
    const entry = (id: string, phase: string, label: string, error?: string): BackgroundTask => ({ ...common, id, label, status: working.includes(phase) ? 'running' : phase === 'uncertain' ? 'interrupted' : phase === 'failed' ? 'failed' : 'completed', stage: phase === 'uncertain' ? '服务商结果待核对，未自动重发' : phase === 'submitting-video' ? '正在提交视频任务，等待服务商确认' : working.includes(phase) ? '模型已接收请求，结果将自动保存到原内容' : phase === 'stale' ? '生成结果已保存，内容版本变化，待核对' : '本阶段媒体结果已保存，等待人工检查', ...(error ? { error } : {}) });
    if (asset.aiCover) rows.push(entry(`media:cover:${project.id}:${asset.aiCover.id}`, asset.aiCover.phase, `封面 · ${asset.title}`, asset.aiCover.error));
    if (asset.aiProduction) {
      const generation = asset.aiProduction, video = !!generation.taskId || ['submitting-video', 'generating-video', 'complete'].includes(generation.phase);
      rows.push(entry(`media:${video ? 'video' : 'frames'}:${project.id}:${generation.id}`, generation.phase, `${video ? '视频' : '关键帧'} · ${asset.title}`, generation.error));
    }
  }
  return rows;
}

// Initial completed media is existing history, not a new completion. A result
// becomes a notification only after this session observed its active phase.
export function mergeMediaTasks(previous: BackgroundTask[], candidates: BackgroundTask[]) {
  const byId = new Map(previous.map(row => [row.id, row])), completed: BackgroundTask[] = [];
  for (const candidate of candidates) {
    const before = byId.get(candidate.id);
    if (!before && candidate.status === 'completed') continue;
    if (before?.status === 'running' && candidate.status === 'completed') completed.push(candidate);
    byId.set(candidate.id, { ...candidate, retained: before?.status === candidate.status ? before.retained : true, startedAt: before?.startedAt || candidate.startedAt });
  }
  const existing = new Set(candidates.map(row => row.id));
  const available = [...byId.values()].filter(row => existing.has(row.id) || row.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt);
  const tasks = [...available.filter(row => row.status === 'running' || row.status === 'interrupted'), ...available.filter(row => row.status !== 'running' && row.status !== 'interrupted').slice(0, 40)];
  return { tasks, completed };
}
