import { useState } from 'react';
import { api } from '../api';
import { Field, Modal } from '../components';
import { useStudio } from '../context';
import type { CapturedComment } from '../desktop';
import { useMCPConnections } from '../pages/MCPConnections';
import '../comment-import.css';

type Preview = { cancelled?: boolean; previewId: string; rows: CapturedComment[]; notice: string };
export function MCPCommentsDialog({ onClose }: { onClose: () => void }) {
  const { project, refresh, notify } = useStudio(), { connections } = useMCPConnections();
  const publications = project!.publications.filter(p => p.status === 'published' && !p.sample);
  const [publicationId, setPublicationId] = useState(publications[0]?.id || ''), [url, setUrl] = useState(''), [limit, setLimit] = useState(200), [replies, setReplies] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [selected, setSelected] = useState<Set<number>>(new Set()), [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const publication = publications.find(p => p.id === publicationId), connection = connections.find(c => c.platform === publication?.platform);
  const path = `/projects/${project!.id}/publications/${publicationId}/mcp/comments`;
  const clear = () => { setPreview(null); setSelected(new Set()); setConfirmed(false); setMessage(''); };
  async function collect() {
    setWorking(true); clear();
    try { const result = await api<Preview>(path, 'POST', { ...(url.trim() ? { sourceUrl: url.trim() } : {}), limit, includeReplies: replies }); if (result.cancelled) { setMessage('本次采集已取消'); return; } setPreview(result); setSelected(new Set(result.rows.map((_, i) => i))); }
    catch (e) { setMessage(e instanceof Error ? e.message : '读取未完成'); }
    finally { setWorking(false); }
  }
  async function save() {
    if (!preview || !confirmed) return; setWorking(true);
    try { const response = await api<{ result: { added: number; duplicates: number } }>(path + '/import', 'POST', { previewId: preview.previewId, confirmed: true, indices: [...selected] }); await refresh(); notify(`已导入 ${response.result.added} 条，跳过 ${response.result.duplicates} 条重复评论`); onClose(); }
    catch (e) { setMessage(e instanceof Error ? e.message : '导入未完成'); }
    finally { setWorking(false); }
  }
  return <Modal title="通过 MCP 获取评论" description="选择自有作品 → 自动读取 → 核对并导入。保留原文、发表时间与评论归属。" wide onClose={() => { if (!working) onClose(); }}>
    <Field label="已发布作品"><select disabled={working} value={publicationId} onChange={e => { setPublicationId(e.target.value); setUrl(''); clear(); }}><option value="" disabled>请选择真实作品</option>{publications.map(p => <option key={p.id} value={p.id}>{p.title} · {p.accountName}</option>)}</select></Field>
    {!publications.length && <p className="info-box">请先在发布中心登记自己作品的链接。</p>}
    <p className="small-note">{connection?.mode === 'external' ? '使用已配置的小红书 MCP。需要带 xsec_token 的完整作品链接，不能用平台主页或其他作品代替。' : '使用内置 MCP，会打开官方作品页并自动滚动。首次使用需在窗口中登录，遇到验证码时等待你处理。'}</p>
    <Field label="本次作品完整链接（可选）" hint="不填使用发布记录中的链接。小红书外部 MCP 如提示缺少 xsec_token，请粘贴同一作品的新分享链接；不会保存链接中的令牌。"><input type="url" disabled={working} value={url} placeholder={publication?.url || 'https://…'} onChange={e => { setUrl(e.target.value); clear(); }}/></Field>
    <div className="comment-capture-options"><Field label="本次数量上限"><select disabled={working} value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={50}>50 条</option><option value={200}>200 条</option><option value={1000}>1,000 条</option></select></Field><label className="checkbox-row"><input type="checkbox" disabled={working} checked={replies} onChange={e => setReplies(e.target.checked)}/>包含回复</label></div>
    <button className="button primary" disabled={working || !publication || !connection || connection.mode === 'builtin' && !connection.builtinAvailable} onClick={() => void collect()}>{working ? '正在处理，请留意平台窗口…' : '开始获取评论'}</button>
    {message && <p className="info-box" role="alert">{message}</p>}
    {preview && <section className="captured-preview"><div className="section-heading"><h3>已读取 {preview.rows.length} 条 · 选中 {selected.size} 条</h3><button className="text-button" disabled={working} onClick={() => { setSelected(selected.size ? new Set() : new Set(preview.rows.map((_, i) => i))); setConfirmed(false); }}>{selected.size ? '取消全选' : '全选'}</button></div><p className="small-note">{preview.notice} 预览保留 30 分钟。</p><div className="captured-rows">{preview.rows.map((row, i) => <label className="captured-row" key={i}><input type="checkbox" disabled={working} checked={selected.has(i)} onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(i); else next.delete(i); setSelected(next); setConfirmed(false); }}/><span><span className="captured-text">{row.text}</span><small>{row.isReply ? '回复' : '评论'}{row.timeLabel ? ` · ${row.timeLabel}` : ''}{row.likes !== null ? ` · ${row.likes} 赞` : ''}</small></span></label>)}</div><label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={working} onChange={e => setConfirmed(e.target.checked)}/>我已核对这些评论属于所选的自有作品。</label></section>}
    <div className="modal-actions"><button className="button" disabled={working} onClick={onClose}>关闭</button><button className="button primary" disabled={working || !preview || !confirmed || !selected.size} onClick={() => void save()}>导入所选评论</button></div>
  </Modal>;
}
