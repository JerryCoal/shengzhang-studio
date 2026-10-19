import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import { useIntegrations } from '../pages/Integrations';
import { openRedfoxSettings, redfoxMoney } from '../pages/RedfoxSettings';
import type { CapturedComment } from '../desktop';
import type { MetricSnapshot } from '../types';
import { METRICS } from '../../server/operating-data.mjs';
import '../comment-import.css';

type Usage = { requests: number; estimatedCny: number };
type ReadPreview = { previewId: string; jobId?: string; provider: 'redfox'; notice: string; sourceUrl: string; limited?: boolean; rows?: CapturedComment[]; metrics?: MetricSnapshot['metrics']; capturedAt?: string; title?: string; cost?: Usage };
type ReadPending = { pending: true; jobId: string; status: string; provider: 'redfox'; notice: string; cost?: Usage };
export function RedfoxReadDialog({ kind, onClose }: { kind: 'comments' | 'detail'; onClose: () => void }) {
  const { project, busy, notify, refresh, go, target } = useStudio();
  const { value, error, reload } = useIntegrations();
  const redfox = value?.redfox;
  const works = project!.publications.filter(publication => publication.status === 'published' && !publication.sample && publication.url);
  const [publicationId, setPublicationId] = useState(works.find(p => p.id === target.publicationId)?.id || works[0]?.id || ''), [limit, setLimit] = useState(50);
  const [acceptedCost, setAcceptedCost] = useState(false), [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<ReadPreview | null>(null), [selected, setSelected] = useState<Set<number>>(new Set()), [message, setMessage] = useState('');
  const [pending, setPending] = useState<ReadPending | null>(null);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publication = works.find(item => item.id === publicationId);
  const capability = redfox?.capabilities.find(item => item.platform === publication?.platform);
  const supported = kind === 'comments' ? capability?.comments : capability?.detail;
  const ready = !!redfox?.supported && redfox.configured && redfox.enabled && !!supported;
  const price = kind === 'comments' ? capability?.costs?.commentsCny : capability?.costs?.detailCny;
  const path = `/projects/${project!.id}/publications/${publicationId}/redfox/${kind}`;
  const clear = () => { setPreview(null); setPending(null); setResetConfirmed(false); setSelected(new Set()); setConfirmed(false); setAcceptedCost(false); setMessage(''); };
  const close = () => { if (!working) onClose(); };
  useEffect(() => {
    if (kind !== 'comments' || !publicationId) return;
    let live = true;
    void api<ReadPending | null>(path + '/status').then(result => { if (live && result?.pending) setPending(result); }).catch(() => {});
    return () => { live = false; };
  }, [path, kind, publicationId]);
  function acceptResult(result: ReadPreview | ReadPending) {
    if ('pending' in result && result.pending) { setPending(result); setMessage(result.notice || '评论任务已提交，请稍后查询结果；查询不会再次提交收费任务。'); return; }
    const ready = result as ReadPreview;
    setPending(ready.jobId ? { pending: true, jobId: ready.jobId, provider: 'redfox', status: 'completed', notice: '原任务结果已返回；导入预览不再次收费。' } : null); setPreview(ready); setSelected(new Set((ready.rows || []).map((_, index) => index)));
    if (kind === 'comments' && !ready.rows?.length) setMessage('本次接口未返回可导入的评论。请核对作品是否公开、链接是否正确；不要将空结果视为平台没有评论。');
  }
  async function poll() {
    if (!pending || working || busy) return;
    setWorking(true); setMessage('');
    try { const result = await api<ReadPending | ReadPreview>(path + '/status', 'POST', { jobId: pending.jobId }); if (mounted.current) acceptResult(result); }
    catch (failure) { if (mounted.current) setMessage(failure instanceof Error ? failure.message : '查询未完成，请稍后重试免费查询。'); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function read() {
    if (working || busy || pending || !publication || !ready || !acceptedCost) return;
    setWorking(true); setMessage(''); setPreview(null); setSelected(new Set()); setConfirmed(false);
    try {
      const result = await api<ReadPreview | ReadPending>(path, 'POST', { confirmed: true, ...(kind === 'comments' ? { limit, includeReplies: false } : {}) });
      if (!mounted.current) return;
      acceptResult(result); setAcceptedCost(false);
      await reload();
    } catch (failure) {
      if (mounted.current) setMessage(failure instanceof Error ? failure.message : '读取未完成，请核对连接与服务商请求记录。');
      if (kind === 'comments') { try { const job = await api<ReadPending | null>(path + '/status'); if (mounted.current && job?.pending) setPending(job); } catch { /* Keep the original request error visible. */ } }
    }
    finally { if (mounted.current) { setWorking(false); setAcceptedCost(false); } }
  }
  async function resetJob() {
    if (!pending || !resetConfirmed || working || busy) return;
    setWorking(true);
    try { await api(path + '/reset', 'POST', { jobId: pending.jobId, confirmed: true }); if (mounted.current) { clear(); setMessage('旧任务锁定已解除。后续重新读取需再次确认费用，不会自动提交。'); } }
    catch (failure) { if (mounted.current) setMessage(failure instanceof Error ? failure.message : '解除锁定未完成，请重试。'); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function save() {
    if (!preview || !confirmed || working || busy) return;
    setWorking(true); setMessage('');
    try {
      const result = await api<{ result?: { added?: number; duplicates?: number } }>(path + '/import', 'POST', { previewId: preview.previewId, confirmed: true, ...(kind === 'comments' ? { indices: [...selected] } : {}) });
      if (!mounted.current) return;
      setPreview(null); setConfirmed(false);
      try { await refresh(); } catch { setMessage('数据已保存，但列表刷新失败。请重新打开页面查看，不必重复导入。'); return; }
      notify(kind === 'comments' ? `已导入 ${result.result?.added || 0} 条评论，跳过 ${result.result?.duplicates || 0} 条重复内容。` : '作品指标已保存为独立采集快照。'); onClose();
    } catch (failure) { if (mounted.current) setMessage(failure instanceof Error ? failure.message : '保存未完成，请重试导入，无需重新付费读取。'); }
    finally { if (mounted.current) setWorking(false); }
  }
  return <Modal title={kind === 'comments' ? 'Redfox 读取评论' : 'Redfox 读取作品指标'} description="选择已发布作品，付费读取后先核对，再保存到当前项目。" onClose={close} wide={kind === 'comments'}>
    <Field label="已发布作品"><select disabled={working || busy} value={publicationId} onChange={event => { setPublicationId(event.target.value); clear(); }}><option value="" disabled>请选择真实作品</option>{works.map(item => <option key={item.id} value={item.id}>{item.title} · {item.accountName}</option>)}</select></Field>
    {!works.length && <p className="info-box">请先在发布中心登记真实作品及链接。</p>}
    <p className="small-note">公开资料由 Redfox 读取。此操作不会登录、切换或发布平台账号；结果保留所选作品和账号归属。</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    {!ready && <div className="info-box"><p>{!redfox?.configured ? '请先保存 Redfox 密钥。' : !redfox.enabled ? 'Redfox 平台资料读取尚未开启。' : capability?.note || '本版尚未接入所选平台的这项读取能力。'}</p><button type="button" className="text-button" disabled={working} onClick={() => { onClose(); openRedfoxSettings(go); }}>查看 Redfox 设置</button></div>}
    {kind === 'comments' && <Field label="本次评论数量上限" hint="首版仅读取接口返回的一级评论，可能不足上限；不保证覆盖全部评论。"><select disabled={working || busy || !!pending} value={limit} onChange={event => { setLimit(Number(event.target.value)); clear(); }}><option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option></select></Field>}
    <div className="info-box"><b>本次使用 Redfox 付费读取</b><p>{price === undefined ? '当前接口费用待核实，请先查看服务商计费。' : `接口每次请求估算 ${redfoxMoney(price)}。`}费用独立按人民币记录，以服务商账单为准。导入已读取的预览不会再次请求 Redfox。</p><label className="checkbox-row"><input type="checkbox" disabled={working || busy} checked={acceptedCost} onChange={event => setAcceptedCost(event.target.checked)}/><span>我了解此次读取可能收费，并确认目标作品。</span></label></div>
    {pending ? <div className="info-box"><b>{pending.status === 'completed' ? '评论任务已返回' : ['uncertain', 'submitting', 'failed'].includes(pending.status) ? '评论任务需要核对' : '评论任务已提交'}</b><p>{pending.notice} 可关闭窗口，重新打开后继续查询。无需重复付费提交。</p><button type="button" className="button" disabled={working || busy} onClick={() => void poll()}>{working ? '正在查询…' : '免费查询已提交任务'}</button><details><summary>核对服务商后结束此任务</summary><p>此操作只解除工作站内的任务锁定，不取消服务商任务，也不退费。之后重新读取会单独提交并收费。</p><label className="checkbox-row"><input type="checkbox" checked={resetConfirmed} disabled={working || busy} onChange={event => setResetConfirmed(event.target.checked)}/>我已核对控制台，确认结束当前任务。</label><button type="button" className="button" disabled={working || busy || !resetConfirmed} onClick={() => void resetJob()}>结束任务并解除锁定</button></details></div> : <button type="button" className="button primary" disabled={working || busy || !ready || !publication || !acceptedCost} onClick={() => void read()}>{working ? '正在处理…' : preview ? '重新付费读取' : '确认并读取'}</button>}
    {message && <p className="info-box" role="alert">{message}</p>}
    {preview && <section className="captured-preview"><div className="section-heading"><h3>{kind === 'comments' ? `已读取 ${preview.rows?.length || 0} 条 · 选中 ${selected.size} 条` : '本次返回的作品指标'}</h3><Pill color="gray">Redfox</Pill></div><p className="small-note">{preview.notice}</p>
      {preview.cost && <p className="small-note">本次已记录 {preview.cost.requests} 次请求 · 估算 {redfoxMoney(preview.cost.estimatedCny)}</p>}
      {kind === 'comments' ? <><button type="button" className="text-button" disabled={working} onClick={() => { setSelected(selected.size ? new Set() : new Set((preview.rows || []).map((_, index) => index))); setConfirmed(false); }}>{selected.size ? '取消全选' : '全选'}</button><div className="captured-rows">{preview.rows?.map((row, index) => <label className="captured-row" key={row.platformCommentId || index}><input type="checkbox" disabled={working} checked={selected.has(index)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(index); else next.delete(index); setSelected(next); setConfirmed(false); }}/><span><span className="captured-text">{row.text}</span><small>{row.timeLabel || '发表时间未知'} · {row.likes === null || row.likes === undefined ? '获赞未知' : `${row.likes} 赞`}</small></span></label>)}</div></> : <><div className="metric-summary-grid">{METRICS.map(metric => <div key={metric.key}><span>{metric.label}</span><b>{preview.metrics?.[metric.key]?.toLocaleString() ?? '—'}</b></div>)}</div><p className="small-note">采集时间：{preview.capturedAt ? new Date(preview.capturedAt).toLocaleString('zh-CN') : '未知'}。缺失指标保持“—”，不会补为零。</p></>}
      <label className="checkbox-row"><input type="checkbox" disabled={working} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>我已核对这些数据属于所选作品。</span></label>
    </section>}
    <div className="modal-actions"><button type="button" className="button" disabled={working} onClick={onClose}>关闭</button><button type="button" className="button primary" disabled={working || busy || !preview || !confirmed || kind === 'comments' && !selected.size || kind === 'detail' && !preview.metrics} onClick={() => void save()}>{kind === 'comments' ? '导入所选评论' : '保存这次指标'}</button></div>
  </Modal>;
}
