import { useState } from 'react';
import { Copy, ExternalLink, Flame } from 'lucide-react';
import { useStudio } from '../context';
import { Empty, Modal, Pill } from '../components';
import { useIntegrations } from './Integrations';
import { LOCAL_DATA } from '../api';
import { KnowledgeActions } from './KnowledgeLibrary';
import { openRedfoxSettings } from './RedfoxSettings';
import '../redfox.css';

const safeURL = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未提供';
export function RedfoxHotspots() {
  const { project, run, mutate, busy, notify, go } = useStudio();
  const { value, reload } = useIntegrations();
  const [confirming, setConfirming] = useState(false), [copy, setCopy] = useState(''), [error, setError] = useState('');
  const enabled = !!value?.redfox?.supported && value.redfox.configured && value.redfox.enabled;
  const result = project?.trends?.redfoxHotspots;
  async function readHotspots() {
    if (!project) return;
    setError('');
    try { await mutate(`/projects/${project.id}/trends/redfox`, 'POST', { confirmed: true }); setConfirming(false); await reload(); notify('平台热榜已保存，请核对榜单口径后选择关键词。'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '本次读取未完成；上次榜单保留。'); setConfirming(false); throw failure; }
  }
  if (!project) return null;
  if (LOCAL_DATA) return <section className="panel"><Empty title="平台热榜需要工作站连接" text="可在 Windows 工作站或团队版中读取榜单。当前仍可查看已保存的资料与项目文档。"/></section>;
  if (!enabled && !result) return <section className="panel"><Empty title="尚未连接平台热榜" text="热榜通过已配置的 Redfox 获取，读取前会显示费用。也可使用同话题研究或公开新闻。"><button className="button" onClick={() => openRedfoxSettings(go)}>设置热榜连接</button></Empty></section>;
  return <section className="panel redfox-hotspots" aria-label="Redfox 平台热榜">
    <div className="section-heading"><div><h2><Flame size={19}/> Redfox 平台热榜</h2><p className="small-note">近一天聚合榜单，仅作选题线索。各平台榜单口径不同，热度不能直接比较。</p></div><Pill color="gray">测试版</Pill></div>
    <div className="redfox-actions"><button className="button" disabled={busy || !enabled} onClick={() => setConfirming(true)}>获取平台热榜</button><span className="small-note">每次目录参考 ¥0.06 · 独立计入 Redfox 人民币费用</span></div>
    {!enabled && <p className="info-box">Redfox 平台资料读取已关闭，保留上次榜单供查看。</p>}
    {error && <p className="error-text" role="alert">{error} 已保存榜单保留；重新读取前仍需确认费用。</p>}
    {result ? <><p className="small-note">采集时间：{date(result.collectedAt)}。{result.note}</p>{result.items.length ? <div className="redfox-hotspot-list">{result.items.map((item, index) => { const url = safeURL(item.url); return <article key={item.id || `${item.url}:${index}`}><div><b>{url ? <a href={url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={12}/></a> : item.title}</b><p className="small-note">{item.platform} · 排名 {item.rank ?? '未提供'} · 平台热度 {item.heat?.toLocaleString() ?? '未提供'}</p><p className="small-note">上榜时间：{date(item.rankedAt)}（非发布时间）</p><KnowledgeActions disabled={busy} source={{title:item.title,text:`热榜选题线索：${item.title}\n关键词：${item.keyword || item.title}\n平台：${item.platform}；排名：${item.rank ?? '未提供'}；热度：${item.heat ?? '未提供'}\n采集：${date(result.collectedAt)}；上榜：${date(item.rankedAt)}（不是发布时间）\n仅作为待核实的选题线索，不能据此判断内容质量或传播原因。`,sourceUrl:url,sourceId:item.id || `${item.url}:${index}`,sourceType:'hotspot'}}/></div><button className="text-button" disabled={busy} onClick={() => void run(async () => { const keyword = item.keyword || item.title; try { await navigator.clipboard.writeText(keyword); notify('已复制关键词，可到同话题与网页研究中使用。'); } catch { setCopy(keyword); } })}><Copy size={13}/>复制关键词</button></article>; })}</div> : <Empty title="本次没有返回榜单条目" text="不表示平台没有热点；可核对服务商返回范围后再决定是否重新付费读取。"/>}</> : <p className="small-note">尚未读取。榜单不会自动加入研究证据或用于生成文案。</p>}
    {copy && <div className="info-box"><p>系统未允许自动复制，请选择下方文字后手动复制。</p><input readOnly aria-label="待复制的热榜关键词" value={copy} onFocus={event => event.target.select()}/></div>}
    {confirming && <Modal title="确认读取 Redfox 平台热榜" description="本次请求可能收费，不会调用分析模型或自动采用榜单内容。" onClose={() => { if (!busy) setConfirming(false); }}><p>目录参考 ¥0.06 / 次，独立记录人民币估算，实际折扣与收费以 Redfox 账单为准。</p><p>返回的上榜时间不是作品发布时间。可收藏线索、保存待验证经验，或继续研究原始内容。</p><div className="modal-actions"><button className="button" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="button primary" disabled={busy || !enabled} onClick={() => void run(readHotspots)}>确认费用并读取</button></div></Modal>}
  </section>;
}
