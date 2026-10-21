import { useRef, useState } from 'react';
import { api } from '../api';
import { useStudio } from '../context';
import { Channel, Modal } from '../components';
import type { Asset, Publication, State } from '../types';
import { assetPublishReadiness } from '../../server/publish-readiness.mjs';
import { assetAccountId } from '../../server/workspace-view.mjs';
import { assertReviewedPublication, runPublicationBatch, type BatchUpdate } from '../../server/publish-batch.mjs';
import { MCPPublishDialog, type PreparedPublication } from './MCPPublishDialog';
import './batch-publish.css';

type Candidate = { id: string; projectId: string; projectName: string; content: Asset | Publication };
type RowResult = { status: string; note: string };
export function BatchPublishDialog({ onClose }: { onClose: () => void }) {
  const { state, project, scope, refresh, runBackground, notify } = useStudio();
  const [selected, setSelected] = useState<string[]>([]), [reviews, setReviews] = useState<Record<string, PreparedPublication>>({});
  const [editing, setEditing] = useState<Candidate | null>(null), [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({}), [finished, setFinished] = useState(false);
  const running = useRef(false);
  const [snapshot, setSnapshot] = useState<{ projectIds: string[]; accountIds: string[]; rows: Candidate[] } | null>(null);
  const projectIds = scope?.projectIds.length ? scope.projectIds : project ? [project.id] : [], accountIds = scope?.accountIds || [];
  const candidates: Candidate[] = state.projects.filter(p => projectIds.includes(p.id) && !p.sample).flatMap(p => {
    const records = p.publications.filter(r => !r.sample && !r.manualReviewRequired && ['scheduled', 'exported'].includes(r.status) && (!r.delivery || r.delivery.phase === 'reset') && (!accountIds.length || accountIds.includes(r.accountId)));
    const assets = p.assets.filter(a => assetPublishReadiness(a).ready && (!accountIds.length || accountIds.includes(assetAccountId(a))) && !p.publications.some(r => r.assetId === a.id && r.assetRevision === a.revision && r.status !== 'cancelled'));
    return [...records, ...assets].map(content => ({ id: `${p.id}:${content.id}`, projectId: p.id, projectName: p.brief.name, content }));
  });
  const rows = selected.map(id => candidates.find(row => row.id === id)).filter((row): row is Candidate => !!row);
  const visibleCandidates = snapshot?.rows || candidates, visibleScope = snapshot || { projectIds, accountIds };
  const setResult = (id: string, value: RowResult) => setResults(old => ({ ...old, [id]: value }));
  const ready = selected.length > 0 && selected.length <= 20 && rows.length === selected.length && rows.every(row => !!reviews[row.id]);
  async function submit() {
    if (!confirmed || !ready || running.current || finished) return;
    running.current = true; setWorking(true);
    setSnapshot({ projectIds: [...projectIds], accountIds: [...accountIds], rows: [...rows] });
    const reviewed = rows.map(row => ({ ...reviews[row.id], id: row.id }));
    const session = sessionStorage.getItem('studio-session'); let started = false;
    const request = async <T,>(path: string, method = 'GET', body?: unknown) => {
      if (sessionStorage.getItem('studio-session') !== session) throw new Error('登录用户已变化，本批次停止后续提交');
      const result = await api<T>(path, method, body);
      if (sessionStorage.getItem('studio-session') !== session) throw new Error('登录用户已变化，请回到原用户核对已执行的条目');
      return result;
    };
    try {
      await runBackground(`多平台发布 · ${reviewed.length} 条`, async control => {
        started = true;
        const prepared: (PreparedPublication & { id: string; publicationId: string })[] = [];
        const targets = new Set<string>();
        // First persist every independent plan. No external publication occurs
        // until all preparation attempts have returned and a checkpoint is saved.
        for (const item of reviewed) {
          try {
            await control.checkpoint('正在核对并保存各平台待办', { items: reviewed.map(r => ({ projectId: r.projectId, assetId: r.assetId, accountId: r.accountId })) });
            const latest = await request<State>('/state');
            const checked = assertReviewedPublication(latest, item), key = `${item.projectId}:${item.assetId}:${item.expectedRevision}:${item.accountId}`;
            if (targets.has(key)) throw new Error('本批次已有相同作品版本和账号，不会重复提交');
            targets.add(key);
            const record = checked.existing || (await request<{ result: Publication }>(`/projects/${item.projectId}/publications`, 'POST', { assetId: item.assetId, accountId: item.accountId, expectedAssetRevision: item.expectedRevision, scheduledAt: new Date().toISOString() })).result;
            prepared.push({ ...item, publicationId: record.id }); setResult(item.id, { status: 'queued', note: '待办已保存，等待本批次提交' });
          } catch (error) { setResult(item.id, { status: 'review', note: error instanceof Error ? error.message : '准备未完成，请单独核对' }); }
        }
        if (prepared.length) {
          await runPublicationBatch(prepared, {
            checkpoint: () => control.checkpoint('即将提交已确认条目；同平台顺序执行，不同平台并行', { items: prepared.map(r => ({ projectId: r.projectId, publicationId: r.publicationId, accountId: r.accountId })) }),
            update: (item, value: BatchUpdate) => setResult(item.id, value),
            submit: async item => {
              const response = await request<{ result: { note: string } }>(`/projects/${item.projectId}/publications/${item.publicationId}/mcp/publish`, 'POST', item.request);
              return response.result;
            },
          });
        }
        await refresh();
        await control.checkpoint('批次已返回，请逐项核对；失败或未知结果不自动重试', { items: prepared.map(r => ({ projectId: r.projectId, publicationId: r.publicationId })) });
      });
    } catch (error) { notify(error instanceof Error ? error.message : '批次结果待核对', true); }
    finally { running.current = false; setWorking(false); setFinished(started); setConfirmed(false); if (!started) setSnapshot(null); }
  }
  return <Modal title="多平台同时发布" wide description="选择不同平台已经完成的作品，逐条核对账号和平台选项，再统一提交。不会把一篇文案未经改编直接复制给所有账号。" onClose={() => { if (!working) onClose(); }}>
    <p className="info-box">{snapshot ? '本批次已确认范围（不随侧栏切换变化）' : '范围'}：{visibleScope.projectIds.length} 个项目 · {visibleScope.accountIds.length ? `${visibleScope.accountIds.length} 个账号` : '全部账号'}。不同平台可并行；同平台及桌面页面助手依次执行。每条结果单独保留，不会因为某条失败重发整批。</p>
    {!candidates.length && !finished && <p>当前范围没有可投送的成品或待办。请先在各平台 Agent 完成内容；可使用“增加平台 / 账号”批量建立改编草稿。</p>}
    <div className="batch-publish-list">{visibleCandidates.map(row => {
      const content = row.content, platform = 'channel' in content ? content.channel : content.platform, review = reviews[row.id], result = results[row.id];
      const owner = review?.accountId || ('accountId' in content ? content.accountId : assetAccountId(content));
      return <article className="batch-publish-row" key={row.id}><label className="batch-publish-choice"><input type="checkbox" checked={selected.includes(row.id)} disabled={working || finished || !selected.includes(row.id) && selected.length >= 20} onChange={event => { setSelected(ids => event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id)); setConfirmed(false); }}/><span><Channel platform={platform}/><b>{content.title}</b><small>{row.projectName} · {state.accounts.find(a => a.id === owner)?.name || '核对时选择账号'} · R{'assetRevision' in content ? content.assetRevision : content.revision}</small></span></label><div><button className="button small" disabled={working || finished || !selected.includes(row.id)} onClick={() => { setEditing(row); setConfirmed(false); }}>{review ? '重新核对' : '核对账号与内容'}</button>{review && <small>已核对 · {review.connectionName}</small>}</div>{result && <p className="batch-publish-result" role="status">{result.status === 'returned' ? '请求已返回，待平台核对' : result.status === 'running' ? '提交中' : result.status === 'queued' ? '已排入本批次' : '需单项处理'}：{result.note}</p>}</article>;
    })}</div>
    {finished && <section className="info-box" role="status"><b>本批次已结束，返回发布中心核对各条回执。</b>{Object.entries(results).map(([id, result]) => <p key={id}>{reviews[id]?.originalTitle || id}：{result.note}</p>)}<p>请求返回不等于审核通过。没有明确回执的条目请先检查平台作品列表，不要重复发布。</p></section>}
    {!finished && <label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={working || !ready} onChange={event => setConfirmed(event.target.checked)}/><span>我已逐条核对以上 {selected.length} 条内容、目标账号、素材和平台选项，允许提交所选条目。</span></label>}
    <div className="modal-actions"><button className="button" disabled={working} onClick={onClose}>{finished ? '返回并核对记录' : '取消'}</button>{!finished && <button className="button primary" disabled={working || !ready || !confirmed} onClick={() => void submit()}>{working ? '正在分平台提交…' : `确认发布所选 ${selected.length} 条`}</button>}</div>
    {editing && <MCPPublishDialog key={editing.id} projectId={editing.projectId} content={editing.content} onClose={() => setEditing(null)} onPrepared={review => { setReviews(old => ({ ...old, [editing.id]: review })); setEditing(null); setConfirmed(false); }}/>}
  </Modal>;
}
