import { useStudio } from '../context';
import type { Asset } from '../types';
import { previewKnowledge } from '../../server/content-workflow.mjs';

export function ContentKnowledgePreview({ asset, query }: { asset: Asset; query?: string }) {
  const { state, project } = useStudio();
  if (!project) return null;
  try {
    const preview = previewKnowledge(state, project, { assetId: asset.id, ...(query?.trim() ? { query: [asset.contentBrief?.requirement, asset.title, query].filter(Boolean).join('\n').slice(0, 4000) } : {}) });
    return <details className="content-fold"><summary>本次参考资料与经验 · {preview.entries.length} 条</summary>
      <p className="small-note">按本篇账号、选择和有效期读取。参考与经验用于表达建议，不能替代已核实事实。</p>
      {preview.entries.map(entry => <article key={entry.id}><b>{entry.title} · {entry.kind === 'experience' ? '待验证经验' : '参考资料'}</b><p className="preserve-lines">{entry.text}</p>{entry.excerpt && <small>本次仅使用以上节选。</small>}</article>)}
      {!preview.entries.length && <p className="small-note">本次没有匹配的已保存资料，仍会使用项目资料和本篇需求。</p>}
      {!!preview.excluded.length && <p className="small-note">有 {preview.excluded.length} 条资料因过期、停用或账号范围不符未使用。</p>}
    </details>;
  } catch (error) { return <p className="error-text" role="alert">{error instanceof Error ? error.message : '无法预览本篇参考资料'}</p>; }
}
