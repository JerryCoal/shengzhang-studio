import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ExternalLink, KeyRound, Loader2, RefreshCw, Search, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { Empty, Field, Modal, Pill } from '../components';
import { useStudio } from '../context';
import { canGenerate } from '../model-provider';
import { useIntegrations } from './Integrations';
import { openRedfoxSettings, redfoxMoney } from './RedfoxSettings';
import { WorkflowSkillSummary } from './CreativeSkills';
import { KnowledgeActions } from './KnowledgeLibrary';
import { redfoxXhsResearchPlan } from '../../server/redfox-research-plan.mjs';
import { researchImageEvidence } from '../../server/research-image-evidence.mjs';
import type { ResearchReport } from '../types';
import type { ResearchAnalysis, ResearchCollectionStats, ResearchDiscovery, ResearchExclusions, ResearchGrowthAdvice, ResearchMetric, ResearchPlatform, ResearchReference, ResearchSearchProvider, ResearchSettingsState, ResearchSource, ResearchState, ResearchStatus } from '../types';
import '../research.css';

const EMPTY: ResearchState = { revision: 0, queries: [], references: [], analyses: [], selectedIds: [], reports: [] };
const PHASES: Record<string, string> = { query: 'AI 整理检索问题', search: '读取所选来源', clean: '清洗与核对发布日期', retrieve: '检索相关参考', analyze: 'AI 分析证据与切入点', completed: '本次研究完成', failed: '本次研究未完成' };
const SOURCE_NAMES: Record<ResearchSource, string> = { web: '扩展网页搜索', xiaohongshu: '小红书内容', douyin: '抖音内容', tiktok: 'TikTok 内容', youtube: 'YouTube 内容', instagram: 'Instagram 内容', rss: '公开中文新闻' };
const PLATFORM_NAMES: Record<ResearchPlatform, string> = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
const METRICS = [['views', '播放'], ['likes', '点赞'], ['comments', '评论'], ['favorites', '收藏'], ['shares', '分享']] as const;
const METRIC_NAMES: Record<string, string> = Object.fromEntries(METRICS);
const TIME_NAMES: Record<ResearchDiscovery['timeRange'], string> = { week: '近七天', month: '近三十天', all: '不限时间' };
const SORT_NAMES: Record<ResearchDiscovery['sortBy'], string> = { general: '同话题优先 · 自动选择可见指标', views: '同话题 · 最多播放', likes: '同话题 · 最多点赞', favorites: '同话题 · 最多收藏', comments: '同话题 · 最多评论', shares: '同话题 · 最多分享' };
const TYPE_NAMES: Record<ResearchDiscovery['noteType'], string> = { all: '全部内容', image: '图文', video: '视频' };
const FOCUS_NAMES: Record<ResearchGrowthAdvice['focus'], string> = { title: '标题', opening: '开头', content: '内容结构', tags: '选题与标签', engagement: '互动设计', experiment: '对比实验' };
const DEFAULT_DISCOVERY: ResearchDiscovery = { timeRange: 'week', sortBy: 'general', noteType: 'all' };
const splitWords = (value: string) => [...new Set(value.split(/[,，、;；\n]+/).map(word => word.trim()).filter(Boolean))];
const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(value => value !== id) : [...list, id];
const money = (value: number) => Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}` : '待确认';
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未核实';
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const safeURL = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
function settingsTab(section: 'research' | 'models' | 'publishing' | 'rules' | 'skills') { try { sessionStorage.setItem('studio-settings-section', section); } catch { /* navigation remains available */ } }

export function RedfoxXhsResearchLimit({ keywordCount, expanded, timeRange }: { keywordCount: number; expanded: boolean; timeRange: ResearchDiscovery['timeRange'] }) {
  if (keywordCount < 1 || keywordCount > 3) return <p className="small-note">填写 1–3 个关键词后显示本轮 Redfox 读取上限。</p>;
  const plan = redfoxXhsResearchPlan(keywordCount, expanded);
  return <div className="research-read-limit" aria-label="本轮 Redfox 小红书读取上限"><p>{timeRange === 'all' ? '按所选优先方式查找。' : '近七天或近三十天先按最新内容查找，清洗后再按所选指标比较。'}{expanded ? '允许读取下一页，并核对缺少日期或正文的详情；没有下一页或只有重复内容时提前停止。' : '已关闭补充读取。'}</p><p><b>读取上限：</b>{expanded ? `每个关键词最多 ${plan.maxPagesPerKeyword} 页，全轮合计最多 ${plan.maxDetails} 次详情` : '每个关键词 1 次搜索，不读取详情'}；本轮最多 {plan.maxSearchRequests} 次搜索 + {plan.maxDetails} 次详情，共 {plan.maxRequests} 次请求，<strong>人民币估算上限 ¥{plan.estimatedCny.toFixed(2)}</strong>。</p><p className="small-note">按实际请求次数记录；这是按当前单价计算的本轮上限估算，实际收费以 Redfox 账单为准。DeepSeek 分析另计项目美元预算。</p></div>;
}

const COLLECTION_LABELS: [keyof ResearchCollectionStats, string][] = [['rawCount', '读取候选'], ['normalizedCount', '格式标准化通过'], ['invalidCount', '格式不兼容'], ['duplicateCount', '采集去重'], ['missingDateCount', '日期未核实'], ['emptyContentCount', '正文缺失'], ['searchRequests', '搜索请求'], ['detailRequests', '详情请求']];
const EXCLUSION_LABELS: [keyof ResearchExclusions, string][] = [['expired', '清洗：超出时间范围'], ['noteType', '清洗：内容类型不符'], ['blocked', '清洗：屏蔽词'], ['dispute', '清洗：争议信号'], ['missingDate', '清洗：缺少日期'], ['uncertainDate', '清洗：日期依据不明'], ['future', '清洗：未来日期'], ['emptyContent', '清洗：缺少正文'], ['invalid', '清洗：字段无效'], ['unsafeUrl', '清洗：链接无效'], ['duplicate', '清洗：重复'], ['limit', '清洗：数量上限']];
const countText = (value: number | null | undefined) => value === null || value === undefined ? '未记录' : value.toLocaleString('zh-CN');
export function ResearchReportStats({ stats }: { stats: ResearchCollectionStats }) {
  return <dl className="research-counts">{COLLECTION_LABELS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{countText(stats[key])}</dd></div>)}</dl>;
}
export function ResearchRunSummary({ research }: { research: ResearchState }) {
  const summary = research.summary?.runId === research.run?.id ? research.summary : undefined;
  if (!summary) return research.run ? <p className="small-note research-saved-scope">本轮未记录独立采集统计。已保存参考总量：{research.references.length} 条，可能包含历史参考，不能当作本轮结果。</p> : null;
  const collection = summary.collection;
  return <section className="panel research-run-summary" aria-label="本轮读取与筛选摘要"><h3>本轮{summary.mode === 'reused' ? '重新分析' : '读取与筛选'}</h3><p className="research-summary-counts">{summary.mode === 'collected' && collection.coverage !== 'unavailable' && <span>{collection.coverage === 'partial' ? '已覆盖来源读取候选' : '读取候选'} <b>{countText(collection.rawCount)}</b></span>}<span>{summary.mode === 'reused' ? '复用候选' : '送入清洗'} <b>{summary.candidateCount}</b></span><span>最终可用 <b>{summary.eligibleCount}</b></span><span>进入分析 <b>{summary.analysisCount}</b></span></p>{summary.pendingCount > 0 && <p className="small-note">另有 {summary.pendingCount} 条待核实线索；未进入可用参考。{summary.failedSources > 0 ? `${summary.failedSources} 份来源读取报告未完成，原因见展开明细。` : ''}</p>}{summary.pendingCount === 0 && summary.failedSources > 0 && <p className="small-note">{summary.failedSources} 份来源读取报告未完成，原因见展开明细。</p>}
    <details className="research-summary-details"><summary>展开本轮读取与筛选明细</summary>{summary.mode === 'reused' ? <p className="small-note">本次复用已保存参考，不新增采集请求。</p> : <><p className="small-note">{collection.coverage === 'partial' ? '采集统计只覆盖提供明细的部分来源，不能作为全部来源总计。' : collection.coverage === 'unavailable' ? '本轮来源未提供采集明细，未记录不代表零。' : '以下为本轮来源的采集统计。'}日期与正文缺失可能出现在同一候选中，不应把各项简单相加。</p><dl className="research-counts">{COLLECTION_LABELS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{countText(collection[key])}</dd></div>)}</dl></>}
    <dl className="research-counts">{EXCLUSION_LABELS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{countText(summary.excluded[key])}</dd></div>)}</dl><p className="small-note">最终可用 {summary.eligibleCount} 条；其中 {summary.analysisCount} 条进入本轮分析。下面的参考和分析还可能保留历史内容。</p></details>
  </section>;
}

function useResearchConnection(localOnly: boolean) {
  const [data, setData] = useState<ResearchSettingsState | null>(null);
  const [loading, setLoading] = useState(!localOnly), [error, setError] = useState('');
  const active = useRef(true), serial = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; serial.current++; }; }, []);
  const reload = useCallback(async () => {
    if (localOnly) { setLoading(false); setData(null); return; }
    const request = ++serial.current; setLoading(true); setError('');
    try { const next = await api<ResearchSettingsState>('/research/settings'); if (active.current && request === serial.current) setData(next); }
    catch (error) { if (active.current && request === serial.current) { setData(null); setError(message(error)); } }
    finally { if (active.current && request === serial.current) setLoading(false); }
  }, [localOnly]);
  useEffect(() => { void reload(); const changed = () => void reload(); window.addEventListener('studio-integrations-changed', changed); return () => window.removeEventListener('studio-integrations-changed', changed); }, [reload]);
  return { data, loading, error, reload };
}

export function ResearchSettings({ onOpenSettings }: { onOpenSettings: (section: 'models' | 'publishing') => void }) {
  const { settings, busy, run, notify, go } = useStudio();
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  const { data, loading, error, reload } = useResearchConnection(localOnly);
  const [provider, setProvider] = useState<ResearchSearchProvider>('none'), [key, setKey] = useState(''), [reservation, setReservation] = useState('0.02'), [clearOpen, setClearOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const options = data?.search.providers || [], selected = options.find(option => option.id === provider), volcano = options.find(option => option.id === 'volcengine');
  useEffect(() => { if (data) { setProvider(data.search.provider === 'redfox' ? 'none' : data.search.provider); setReservation(String(data.search.providers.find(option => option.id === 'volcengine')?.reservationCny ?? .02)); } }, [data]);
  const amount = Number(reservation), validAmount = Number.isFinite(amount) && amount > 0 && amount <= 1;
  const redfoxSearch = data?.search.provider === 'redfox';
  const providerChanged = !!data && !redfoxSearch && provider !== data.search.provider;
  const keyChanged = !!key.trim() || !!volcano && amount !== volcano.reservationCny;
  const saveProvider = () => void run(async () => { await api('/research/settings', 'PUT', { provider: provider === 'redfox' ? 'none' : provider }); await reload(); notify('搜索方式已保存；切换不会删除原来的密钥'); });
  return <section className="panel research-settings" aria-label="联网检索设置">
    <div className="section-heading"><div><h2><Search size={19}/>选择适合你的研究方式</h2><p className="muted">同话题内容研究使用平台读取服务和 DeepSeek。公开新闻无需搜索密钥，网页扩展服务可以按需选择。</p></div><Pill color={data?.search.provider === 'none' ? 'gray' : data?.search.configured ? 'green' : 'amber'}>{data?.search.provider === 'none' ? '无需新增搜索密钥' : data?.search.configured ? '已保存搜索配置' : '按需连接'}</Pill></div>
    {localOnly ? <p className="info-box">此版本暂不运行联网研究，也不接收搜索密钥。请使用 Windows 版的加密本地工作区；已有新闻线索与标签可继续使用。</p> : <>
      {loading && <p className="small-note" role="status">正在读取搜索配置…</p>}
      {error && <div className="research-error" role="alert">{error}<button type="button" className="text-button" disabled={loading} onClick={() => void reload()}>重新读取配置</button></div>}
      {data && (!data.available ? <p className="info-box">联网研究目前需要 Windows 版的加密本地用户工作区，当前环境暂不开放此入口。</p> : <>
        <div className="research-start-note"><b>先用已有配置开始</b><p>在“热点与灵感”选择同话题模式，启用 Redfox 资料读取或连接支持搜索的平台 MCP，并保存 DeepSeek 密钥即可开始。下面的网页搜索设置只用于“近期热点与网页”模式；公开新闻采集无需搜索 API Key，AI 分析仍按模型用量计费。</p></div>
        {redfoxSearch && <div className="info-box"><b>当前通过 Redfox · Kimi 联网搜索</b><p>此开关覆盖原网页搜索路由。原有搜索密钥与选择保留，关闭 Redfox 联网搜索后即可恢复；费用单独记录，不占下方旧研究实验预算。</p><button className="text-button" onClick={() => openRedfoxSettings(go)}>管理 Redfox 联网搜索</button></div>}
        <fieldset className="research-provider-options" disabled={redfoxSearch}><legend>是否增加网页搜索？</legend>{options.filter(option => option.id !== 'redfox').map(option => <label key={option.id} className={provider === option.id ? 'selected' : ''}><input type="radio" name="research-search-provider" value={option.id} checked={provider === option.id} disabled={busy || !data.search.editable} onChange={() => { setProvider(option.id); setKey(''); if (option.id === 'volcengine' && !option.configured) setAdvanced(true); }}/><span><b>{option.name}</b><small>{option.id === 'none' ? '先用公开新闻，无需额外密钥' : option.id === 'qwen' ? '复用文字模型中的 Qwen 密钥，无需再填' : '使用这个搜索产品的独立密钥'}</small><em>{option.id === 'none' ? '默认推荐' : !option.supported ? '当前配置不支持' : option.configured ? '已保存配置' : '待配置'}</em></span></label>)}</fieldset>
        {selected && <div className="research-provider-detail"><p>{selected.note}</p>{provider === 'qwen' && <><p className="small-note">这里不会要求第二份 Qwen 密钥。每次研究最多 {selected.maxRequests} 次联网请求，单次按 {money(selected.reservationCny)} 估算预留，包括联网模型与搜索服务；这是本地预算估算，并非服务商实际收费上限。</p><button className="button small" disabled={busy} onClick={() => onOpenSettings('models')}>{selected.configured ? '查看已有 Qwen 配置' : '前往文字模型配置 Qwen'}</button></>}{provider === 'none' && <button className="text-button" disabled={busy} onClick={() => onOpenSettings('models')}>查看已有文字模型</button>}</div>}
        <div className="research-actions"><button className="button primary" disabled={busy || !data.search.editable || redfoxSearch || !providerChanged} onClick={saveProvider}><Check size={16}/>保存搜索方式</button><small>{redfoxSearch ? 'Redfox 路由已开启，关闭后显示并恢复原搜索方式。' : providerChanged ? '当前选择尚未保存，研究仍使用上次保存的方式。' : '切换方式会保留已有密钥，不会自动发起搜索。'}</small></div>
        <details className="research-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary><KeyRound size={15}/>高级连接：豆包搜索 Custom版（火山）</summary>
          <p className="small-note">仅在你选择这个服务时需要配置。它与 Seedream、Seedance 使用的方舟密钥不同，不能混用。</p>
          <div className="research-setup-links"><a href={safeURL(volcano?.setupUrl || '') || 'https://console.volcengine.com/search-infinity/web-search'} target="_blank" rel="noreferrer">① 开通搜索服务 <ExternalLink size={12}/></a><a href={safeURL(volcano?.keyUrl || '') || 'https://console.volcengine.com/search-infinity/api-key?tab=post_paid'} target="_blank" rel="noreferrer">② 创建按量 API Key <ExternalLink size={12}/></a><a href="https://console.volcengine.com/search-infinity/api-key?tab=subscription_plan" target="_blank" rel="noreferrer">订阅套餐密钥入口 <ExternalLink size={12}/></a></div>
          <div className="research-key-status"><ShieldCheck size={17}/>{volcano?.configured ? `已在本机加密保存 · 末尾 ${volcano.suffix || ''}` : '尚未保存火山搜索密钥'}</div>
          <form autoComplete="off" onSubmit={event => { event.preventDefault(); if (!validAmount || !keyChanged) return; const submitted = key.trim(); setKey(''); void run(async () => { await api('/research/settings', 'PUT', { provider: 'volcengine', ...(submitted ? { apiKey: submitted } : {}), reservationCny: amount }); await reload(); notify('火山搜索配置已保存并选用，密钥输入框已清空'); }); }}>
            <div className="research-advanced-fields"><Field label={volcano?.configured ? '替换火山搜索 API Key' : '填写火山搜索 API Key'}><input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={2048} value={key} disabled={busy || !data.search.editable} placeholder="只填写豆包搜索 Custom版的独立密钥" onChange={event => setKey(event.target.value)}/></Field>
            <Field label="每次搜索预留（人民币元）" hint="按套餐调整，用于本地预算控制；实际金额以服务商账单为准。"><input type="number" min="0.001" max="1" step="0.001" value={reservation} disabled={busy || !data.search.editable} onChange={event => setReservation(event.target.value)}/></Field></div>
            <div className="research-actions"><button className="button" disabled={busy || !data.search.editable || !validAmount || !keyChanged}><Check size={16}/>保存并使用火山搜索</button><button type="button" className="text-button" disabled={busy || !data.search.editable || !volcano?.configured} onClick={() => setClearOpen(true)}><Trash2 size={15}/>删除火山搜索密钥</button></div>
          </form>
        </details>
        <details className="research-advanced research-models"><summary>查看模型分工、其他来源与费用</summary><dl><div><dt>检索问题规划</dt><dd>{data.search.provider === 'redfox' ? 'Redfox Kimi 联网直接使用关键词，省去一次扩词调用' : data.search.provider === 'qwen' ? 'Qwen 联网直接使用你的关键词，省去一次扩词调用' : `${data.models.query} · 沿用已有文字模型`}</dd></div><div><dt>参考分析</dt><dd>{data.models.analysis} · 沿用已有文字模型</dd></div><div><dt>参考库检索</dt><dd>默认本地关键词；可选已配置的 Qwen 语义检索</dd></div><div><dt>小红书来源</dt><dd>{data.mcpNote || '在账号与发布中连接并检查 MCP 搜索能力'}</dd></div></dl><p className="small-note">文字模型计入项目美元预算；扩展原搜索与可选向量请求共用每项目人民币 1 元研究实验预算；Redfox 费用独立记录，不占此预算。未选择的搜索服务不会调用，也不会自动切换收费服务。</p><div className="research-actions"><button className="button small" onClick={() => onOpenSettings('models')}>设置文字模型</button><button className="button small" onClick={() => onOpenSettings('publishing')}>检查平台连接</button></div></details>
      </>)}
    </>}
    {clearOpen && <Modal title="删除火山搜索密钥" description="仅删除本机保存的火山搜索密钥，当前搜索方式不变。Qwen 密钥和已保存参考仍保留。" onClose={() => { if (!busy) setClearOpen(false); }}><div className="modal-actions"><button className="button" disabled={busy} onClick={() => setClearOpen(false)}>保留</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await api('/research/settings', 'PUT', { clearKey: true }); setClearOpen(false); await reload(); notify('火山搜索密钥已从本机删除'); })}>确认删除火山搜索密钥</button></div></Modal>}
  </section>;
}

function metricLabel(metric?: ResearchMetric) {
  if (!metric || metric.value === null || !Number.isFinite(metric.value)) return metric?.raw ? `未核实（原始 ${metric.raw}）` : '未提供';
  return `${metric.approximate ? '约 ' : ''}${metric.value.toLocaleString('zh-CN')}${metric.approximate && metric.raw ? `（${metric.raw}）` : ''}`;
}
export function ResearchReferenceImages({ reference }: { reference: unknown }) {
  const evidence = researchImageEvidence(reference), [show, setShow] = useState(false), [failed, setFailed] = useState<string[]>([]);
  if (!evidence) return null;
  const linked = evidence.images.filter(row => row.url);
  return <section className="research-image-evidence" aria-label="图片与来源已有描述"><b>图片与来源已有描述</b><p className="small-note">图片链接未经过本次模型查看。图片不可展示时，正文、来源和下方已有描述仍保留；不能据此猜测画面。</p>{evidence.analysis && <div><strong>来源提供的图片分析 · 未重新核图</strong><p>{evidence.analysis}</p></div>}{evidence.images.map((row, index) => <div key={row.url || index}>{row.description && <p>来源描述：{row.description}</p>}{show && row.url && (failed.includes(row.url) ? <p className="small-note">这张图片暂时无法展示，可打开原文核对；文字与已有分析未删除。</p> : <img src={row.url} alt={row.description || '来源图片，需人工核对'} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(previous => [...previous, row.url!])}/>)}</div>)}{linked.length > 0 && !show && <button className="text-button" onClick={() => setShow(true)}>尝试显示 {linked.length} 张来源图片（连接图片来源）</button>}</section>;
}
export function ResearchSourceReport({ report }: { report: ResearchReport }) {
  return <div><b>{report.name} · {report.status === 'ok' ? `${report.count} 条` : report.status === 'failed' ? report.count > 0 ? `部分完成 · 已取得 ${report.count} 条` : '未读取成功' : '已跳过'}</b><p>{report.message}</p>{report.diagnostic ? <div className="research-warning"><p>诊断：{report.diagnostic.message} · {report.diagnostic.code}</p><p>下一步：{report.diagnostic.nextStep}</p></div> : report.status === 'failed' && <p className="small-note">这份报告未记录更具体的故障分类，不能仅凭“0 条”判断是没有内容、服务未启动或登录失效。请核对连接与登录，或提供这份来源报告。</p>}{report.stats && <ResearchReportStats stats={report.stats}/>}</div>;
}
function ReferenceCard({ reference, quote }: { reference: ResearchReference; quote?: string }) {
  const url = safeURL(reference.url);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const basis: Record<string, string> = { page: '网页发布日期', detail: '详情页时间', rss: 'RSS 发布时间', publishedAt: '来源发布时间', note_time: '笔记详情时间', 'search-metadata': '搜索服务提供的发布时间（尚未逐页核对）', 'platform-timestamp': '平台详情页发布时间', 'publisher-feed': '新闻订阅源发布时间', 'page-published-metadata': '原文网页提供的发布日期' };
  return <article className="research-reference">
    <div className="research-reference-header">{reference.topicRanking?.sampleRank ? <span className="research-sample-rank">同话题样本 #{reference.topicRanking.sampleRank}</span> : reference.discoveryRanking && <span className="research-sample-rank">样本 #{reference.discoveryRanking.sampleRank}</span>}<b>{reference.title}</b>{url && <a href={url} target="_blank" rel="noreferrer">核对原文 <ExternalLink size={12}/></a>}</div>
    <p className="research-source-meta">{reference.sourceName || SOURCE_NAMES[reference.kind]}{reference.kind in PLATFORM_NAMES ? ` · ${reference.noteType === 'image' ? '图文' : reference.noteType === 'video' ? '视频' : '形式未核实'}` : ''} · 发布 {date(reference.publishedAt)} · 采集 {date(reference.collectedAt)}</p>
    {quote && <blockquote>{quote}</blockquote>}
    <button type="button" className="text-button research-material-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {expanded ? '收起素材详情' : '展开素材详情'}</button>
    <div id={detailsId} className="research-reference-details" hidden={!expanded}>
    <p className="small-note">日期依据：{basis[reference.dateBasis] || (/[\u4e00-\u9fff]/.test(reference.dateBasis) ? reference.dateBasis : '来源提供的发布时间，尚需核对')}</p>
    {!quote && <p className="research-reference-text">{reference.text || '来源未提供正文，请打开原文核对。'}</p>}
    <ResearchReferenceImages reference={reference}/>
    <dl className="research-metrics">{METRICS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{metricLabel(reference.metrics?.[key])}</dd></div>)}</dl>
    {reference.topicRanking && <p className="small-note">{reference.topicRanking.relevant ? `命中：${reference.topicRanking.matchedKeywords.join('、')} · 按${METRIC_NAMES[reference.topicRanking.metric] || reference.topicRanking.metric}比较 ${reference.topicRanking.knownSamples} 条有数据的同话题样本。${reference.topicRanking.value === null ? '此指标未提供，不能据此判断高流量。' : reference.topicRanking.knownSamples < 5 ? '样本少于 5 条，暂不建立热度基线。' : '只是当前采集样本中的表现，不是平台排名。'}` : '尚未核对主题关联 · 已保留供查看，不送入本轮 AI 分析。可添加同义词后重新采集。'}</p>}
    {reference.sourceAccountName && <p className="small-note">采集连接：{reference.sourceAccountName}。这是读取资料的账号，不代表内容作者。</p>}
    {reference.discoveryRanking && <p className="small-note">{SORT_NAMES[reference.discoveryRanking.sortBy]} · 命中关键词：{reference.discoveryRanking.matchedKeywords.join('、') || '待核对关联'}。只在本次可读取样本中比较；未提供的指标不按 0 计算。</p>}
    <p className="small-note">{reference.riskReason || '名称及素材的使用权利尚未核实，请核对适用条件。'}</p>
    <KnowledgeActions source={{title:reference.title,text:[reference.text || '来源未提供正文，请打开原文核对。',`采集时间：${date(reference.collectedAt)}；发布时间：${date(reference.publishedAt)}`,`适用限制：${reference.riskReason || '仅作创作参考，内容与适用条件需核对。'}`].join('\n\n'),sourceUrl:reference.url,sourceId:reference.id,sourceType:'research-reference',...(reference.kind in PLATFORM_NAMES ? {platform:reference.kind as ResearchPlatform} : {})}}/>
    </div>
  </article>;
}

function ReferenceCollection({ references, title, web = false }: { references: ResearchReference[]; title: string; web?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  return <section className="panel research-discovered-posts" aria-label={title}>
    <div className="section-heading"><div><h3>{title} <Pill color="gray">{references.length} 条可核对样本</Pill></h3><p className="muted">素材默认收起，可按需展开核对主题、正文与{web ? '来源日期' : '互动数据'}。</p></div><button type="button" className="button small research-material-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>} {expanded ? '收起素材' : '展开素材'}</button></div>
    <div id={listId} hidden={!expanded}><p className="small-note">{web ? '网页与新闻只作为有出处的素材。采用前请核对原文、发布日期与适用条件。' : '按本轮采集结果展示。先核对主题相关性，再比较播放或互动；未提供的数字保留未知。'}</p><div className="research-post-grid">{references.map(reference => <ReferenceCard reference={reference} key={`${reference.id}:${reference.collectedAt}`}/>)}</div></div>
  </section>;
}

function AnalysisCard({ analysis, references, chosen, acknowledged, disabled, full, onChoose, onAcknowledge }: { analysis: ResearchAnalysis; references: ResearchReference[]; chosen: boolean; acknowledged: boolean; disabled: boolean; full: boolean; onChoose: () => void; onAcknowledge: () => void }) {
  return <article className={`panel research-analysis ${chosen ? 'chosen' : ''}`}>
    <label className="research-analysis-title"><input type="checkbox" aria-label={`选用 ${analysis.title}`} checked={chosen} disabled={disabled || !chosen && full} onChange={onChoose}/><h3>{analysis.title}</h3></label>
    {analysis.discovery && <p className="small-note">{PLATFORM_NAMES[analysis.discovery.platform || 'xiaohongshu']}参考 · {TIME_NAMES[analysis.discovery.timeRange]} · {SORT_NAMES[analysis.discovery.sortBy]} · {TYPE_NAMES[analysis.discovery.noteType]}</p>}
    <dl className="research-findings"><div><dt>观察到的内容</dt><dd>{analysis.observation}</dd></div><div><dt>可能的吸引点 · 待验证</dt><dd>{analysis.hypothesis}</dd></div><div><dt>如何用于本项目</dt><dd>{analysis.application}</dd></div></dl>
    {!!analysis.growthAdvice?.length && <section className="research-growth-advice" aria-label="流量改进建议"><h4>可以尝试的流量改进</h4>{analysis.growthAdvice.map((advice, index) => <article key={`${advice.focus}:${index}`}><span>{FOCUS_NAMES[advice.focus] || '创作建议'}</span><b>{advice.action}</b><p>{advice.reason}</p><p className="research-validation"><strong>如何验证：</strong>{advice.validation}</p><p className="small-note">参考：{advice.referenceIds.map(id => { const ref = references.find(reference => reference.id === id), url = safeURL(ref?.url || ''); return ref ? <span key={id}>{url ? <a href={url} target="_blank" rel="noreferrer">{ref.title}<ExternalLink size={11}/></a> : ref.title} </span> : null; })}</p></article>)}</section>}
    <div className="research-tags" aria-label="建议创作标签">{analysis.tags.map(tag => <span key={tag}><Tag size={12}/>{tag}</span>)}</div>
    <details className="research-evidence"><summary>查看 {analysis.evidence.length} 条原文证据、日期与互动数据</summary>{analysis.evidence.map((item, index) => { const reference = references.find(reference => reference.id === item.referenceId); return reference ? <ReferenceCard key={`${item.referenceId}:${index}`} reference={reference} quote={item.quote}/> : <p key={index} className="small-note">该引用的来源未找到，采用前请重新核对。</p>; })}</details>
    <p className="research-limitation"><b>局限：</b>{analysis.limitations || '样本有限，不能据此判断传播原因或转化效果。'}</p>
    <div className={`research-risk ${analysis.risk === 'review' ? 'review' : ''}`}><b>{analysis.risk === 'review' ? '涉及名称或权利风险 · 需逐项确认' : '权利状态未核实 · 使用前需检查'}</b><p>借鉴表达结构与场景，不直接搬用他人的正文、封面或品牌身份。</p>{analysis.risk === 'review' && <label><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={onAcknowledge}/>我已核对名称及素材的使用条件，确认本项目可以采用这项参考。</label>}</div>
    <KnowledgeActions source={{title:analysis.title,text:[`观察：${analysis.observation}`,`待验证假设：${analysis.hypothesis}`,`可尝试的应用：${analysis.application}`, ...(analysis.growthAdvice || []).map(advice=>`建议：${advice.action}\n理由：${advice.reason}\n验证方式：${advice.validation}`),`局限：${analysis.limitations || '样本有限，不能据此判断传播原因或转化效果。'}`, ...analysis.evidence.map(item=>{const ref=references.find(reference=>reference.id===item.referenceId);return `原文依据：${item.quote}${ref ? `\n${ref.title}\n${ref.url}` : '\n来源待核对'}`;})].join('\n\n'),sourceId:analysis.id,sourceType:'research-analysis',sourceUrl:references.find(reference=>analysis.evidence.some(item=>item.referenceId===reference.id))?.url,platform:analysis.discovery?.platform}}/>
  </article>;
}

export function ResearchPanel({ initialKeywords, initialPlatform }: { initialKeywords?: string; initialPlatform?: ResearchDiscovery['platform'] } = {}) {
  const { project, settings, busy, run, runBackground, mutate, refresh, notify, go } = useStudio();
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  const connection = useResearchConnection(localOnly);
  const [live, setLive] = useState<ResearchStatus | null>(null), [statusError, setStatusError] = useState('');
  const [keywords, setKeywords] = useState(initialKeywords || project?.brief.product.slice(0, 30) || '');
  const [mode, setMode] = useState<'xiaohongshu' | 'web'>(initialPlatform ? 'xiaohongshu' : project?.research?.run && !project.research.run.discovery ? 'web' : 'xiaohongshu');
  const [discovery, setDiscovery] = useState<ResearchDiscovery>(initialPlatform ? { ...DEFAULT_DISCOVERY, platform: initialPlatform } : project?.research?.run?.discovery || DEFAULT_DISCOVERY);
  const [accountId, setAccountId] = useState('');
  const [dataProvider, setDataProvider] = useState<'mcp' | 'redfox' | null>(null);
  const [redfoxXhsExpansion, setRedfoxXhsExpansion] = useState(true);
  const { value: integrations } = useIntegrations();
  const [resetSearch, setResetSearch] = useState(false);
  const [analysisModel, setAnalysisModel] = useState(project?.research?.run?.analysisModel && settings.models[project.research.run.analysisModel]?.provider === 'deepseek' ? project.research.run.analysisModel : settings.models[settings.routes.analysis]?.provider === 'deepseek' ? settings.routes.analysis : 'deepseek-flash');
  const [sources, setSources] = useState<ResearchSource[]>(['rss']), [useSemantic, setUseSemantic] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]), [ack, setAck] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<'collect' | 'reuse' | null>(null), [pending, setPending] = useState(false), [pollPaused, setPollPaused] = useState(false);
  const mounted = useRef(true), statusSequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; statusSequence.current++; }; }, []);
  const saved = project?.research || EMPTY;
  const current = live && live.research.revision >= saved.revision ? live.research : saved;
  const running = pending || current.run?.status === 'running';
  const disabled = busy || running;
  const keywordList = splitWords(keywords), config = connection.data;
  const xhsMode = mode === 'xiaohongshu';
  const platform = discovery.platform || 'xiaohongshu', platformName = PLATFORM_NAMES[platform];
  const platformConnection = config?.platformSources?.find(source => source.platform === platform);
  const selectedProvider = dataProvider || platformConnection?.provider || 'mcp';
  const redfoxData = selectedProvider === 'redfox';
  const redfoxXhsDiscovery = xhsMode && redfoxData && platform === 'xiaohongshu';
  const providerOption = platformConnection?.providers?.find(item => item.id === selectedProvider);
  const mcpAccounts = platformConnection?.mcpAccounts || platformConnection?.accounts || [];
  const selectedAccount = redfoxData ? undefined : mcpAccounts.find(account => account.id === accountId);
  const redfoxCosts = integrations?.redfox?.capabilities.find(item => item.platform === platform)?.costs;
  const dataRouteName = redfoxData ? 'Redfox 公开资料' : 'MCP';
  const activeSemantic = !xhsMode && useSemantic, keywordLimit = xhsMode ? 3 : 8;
  const activeSources: ResearchSource[] = xhsMode ? [platform] : sources;
  const deepseekModels = Object.entries(settings.models).filter(([, model]) => model.provider === 'deepseek');
  const deepseekConfigured = config?.deepseekConfigured ?? !!settings.providers?.deepseek?.configured;
  const queryConfigured = canGenerate(settings, 'classification'), analysisConfigured = xhsMode ? deepseekConfigured && settings.models[analysisModel]?.provider === 'deepseek' : canGenerate(settings, 'analysis');
  const useQwenSearch = !xhsMode && sources.includes('web') && config?.search.provider === 'qwen';
  const useRedfoxSearch = !xhsMode && sources.includes('web') && config?.search.provider === 'redfox';
  const queryRequired = !xhsMode && !useQwenSearch && !useRedfoxSearch;
  const valid = keywordList.length >= 1 && keywordList.length <= keywordLimit && keywordList.every(word => word.length <= 30) && activeSources.length > 0;
  const mcpReady = providerOption ? providerOption.supported && (selectedAccount ? selectedAccount.configured : providerOption.configured) : platformConnection ? (selectedAccount ? selectedAccount.configured : platformConnection.supported && platformConnection.configured) : platform === 'xiaohongshu' && !!config?.mcpConfigured && config.mcpSearchSupported !== false;
  const canRun = !localOnly && !!config?.available && valid && (!queryRequired || queryConfigured) && analysisConfigured && (!xhsMode || mcpReady) && (!activeSources.includes('web') || config.search.configured) && (!activeSemantic || !!settings.providers?.qwen?.configured);
  const reusableCount = current.references.filter(reference => !xhsMode || reference.kind === platform).length;
  const canReuse = !localOnly && !!config?.available && valid && analysisConfigured && reusableCount > 0 && (!activeSemantic || !!settings.providers?.qwen?.configured);
  const selectionKey = current.selectedIds.join('|'), analysesKey = current.analyses.map(item => item.id).join('|');
  useEffect(() => { setChosen(current.selectedIds); setAck(current.analyses.filter(item => current.selectedIds.includes(item.id) && item.risk === 'review').map(item => item.id)); }, [selectionKey, analysesKey]);
  const readStatus = useCallback(async () => {
    if (localOnly || !project || !connection.data?.available) return;
    const request = ++statusSequence.current;
    try { const value = await api<ResearchStatus>(`/projects/${project.id}/research/status`); if (mounted.current && request === statusSequence.current) { setLive(value); setStatusError(''); } return value; }
    catch (error) { if (mounted.current && request === statusSequence.current) setStatusError(message(error)); }
  }, [localOnly, project?.id, connection.data?.available]);
  useEffect(() => { void readStatus(); }, [readStatus, project?.revision]);
  useEffect(() => {
    if (!running || localOnly || !config?.available) return;
    let cancelled = false, count = 0, timer: ReturnType<typeof setTimeout>;
    setPollPaused(false);
    const tick = async () => { if (cancelled) return; const value = await readStatus(); count++; if (cancelled) return; if (value?.research.run?.status && value.research.run.status !== 'running') { await refresh().catch(() => {}); return; } if (count >= 60) { setPollPaused(true); return; } timer = setTimeout(() => void tick(), 3000); };
    timer = setTimeout(() => void tick(), 3000); return () => { cancelled = true; clearTimeout(timer); };
  }, [running, localOnly, config?.available, readStatus, refresh]);
  if (!project) return null;
  const selected = current.analyses.filter(item => current.selectedIds.includes(item.id));
  const selectionChanged = JSON.stringify([...chosen].sort()) !== JSON.stringify([...current.selectedIds].sort());
  const riskPending = chosen.some(id => current.analyses.find(item => item.id === id)?.risk === 'review' && !ack.includes(id));
  const reservation = config?.search.reservationCny ?? 0, maxRequests = config?.search.maxRequests ?? 0;
  const searchOption = config?.search.providers.find(option => option.id === config.search.provider);
  const searchName = searchOption?.name || '扩展网页搜索';
  const remaining = live ? Math.max(0, live.budgetCny - live.usageCny) : null;
  const start = () => { const reuseCollected = confirming === 'reuse'; if (!(reuseCollected ? canReuse : canRun) || disabled) return; setConfirming(null); void runBackground(reuseCollected ? '分析已保存参考' : xhsMode ? `发现${platformName}同话题内容` : '研究近七天内容', async () => { setPending(true);
    try { await mutate(`/projects/${project.id}/research/run`, 'POST', { keywords: keywordList, sources: activeSources, expectedRevision: current.revision, confirmed: true, useSemantic: activeSemantic, reuseCollected, ...(redfoxXhsDiscovery && !reuseCollected ? { redfoxXhsExpansion } : {}), ...(xhsMode ? { discovery, analysisModel, dataProvider: selectedProvider, ...((!redfoxData && (accountId || platformConnection?.accountId)) ? { accountId: accountId || platformConnection?.accountId } : {}) } : {}) }); await readStatus(); notify(xhsMode ? '同话题内容与分析已保存，请核对建议并挑选创作参考' : '近期内容研究已保存，请核对证据后挑选创作参考'); }
    finally { if (mounted.current) setPending(false); await readStatus(); }
  }); };
  return <div className="research-workspace">
    <div className="research-mode-switch" role="group" aria-label="选择研究方式"><button type="button" aria-pressed={xhsMode} className={xhsMode ? 'selected' : ''} disabled={disabled} onClick={() => setMode('xiaohongshu')}><b>同话题高表现内容</b><span>找相关内容 → 核对表现 → 拆解与试验</span></button><button type="button" aria-pressed={!xhsMode} className={!xhsMode ? 'selected' : ''} disabled={disabled} onClick={() => setMode('web')}><b>近期热点与网页</b><span>公开新闻与网页 → 核对来源 → 提取参考</span></button></div>
    <ol className="research-steps"><li><span>1</span><div><b>设置研究范围</b><small>关键词、来源、费用</small></div></li><li><span>2</span><div><b>核对证据与分析</b><small>观察、假设、原始数据</small></div></li><li><span>3</span><div><b>挑选后用于创作</b><small>标签、事实、写作 Skills</small></div></li></ol>
    <section className="panel research-scope" aria-label="内容研究设置"><div className="section-heading"><div><h2><Search size={19}/>{xhsMode ? `找到值得参考的${platformName}内容` : '近七天内容研究'}</h2><p className="muted">{xhsMode ? '先找同话题，再比较真实可见指标，分析可能的吸引点并形成创作实验。' : '寻找相关内容与可验证的切入点，不把搜索结果直接称为“爆款”。'}</p></div><Pill color="gray">手动触发</Pill></div>
      {localOnly ? <p className="info-box">当前版本暂不运行联网研究，请使用 Windows 版的加密本地工作区。已有参考可查看，原有 RSS 新闻功能保留在下方。</p> : connection.loading ? <p className="small-note">正在读取研究连接配置…</p> : connection.error ? <div className="research-error" role="alert">{connection.error}<button className="text-button" onClick={() => void connection.reload()}>重试读取配置</button></div> : !config?.available ? <p className="info-box">联网研究需要 Windows 版的加密本地用户工作区。</p> : null}
      <Field label={xhsMode ? '要找的主题或关键词' : '这次要研究的项目关键词'} hint={`1–${keywordLimit} 个，每个最多 30 字，用逗号分隔。建议填写受众、使用场景和具体需求。`}><textarea rows={2} maxLength={260} value={keywords} disabled={disabled || localOnly} onChange={event => setKeywords(event.target.value)} placeholder="例如：学习搭子，大学生自习，校园社交"/></Field>
      {keywordList.length > keywordLimit && <p className="research-warning">当前方式最多支持 {keywordLimit} 个关键词，请减少后再开始。</p>}
      <p className="knowledge-scope-summary small-note">当前范围：{xhsMode ? `${platformName} · ${TIME_NAMES[discovery.timeRange]} · ${TYPE_NAMES[discovery.noteType]} · ${dataRouteName}` : `近七天 · ${activeSources.map(source => SOURCE_NAMES[source]).join('、') || '尚未选择来源'}`}。</p>
      <details className="knowledge-research-options"><summary>调整研究范围、读取服务与分析模型</summary>
      {xhsMode && <div className="research-discovery-filters"><Field label="研究平台" hint="每轮研究一个平台，避免混合不同平台的计数口径。"><select value={platform} disabled={disabled || localOnly} onChange={event => { const next = event.target.value as ResearchPlatform; setDiscovery({ ...discovery, platform: next, sortBy: 'general', noteType: next === 'youtube' ? 'video' : 'all' }); setAccountId(''); setDataProvider(null); }}>{Object.entries(PLATFORM_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{platformConnection?.providers && <Field label="资料读取服务" hint="Redfox 读取公开资料并单独计费；MCP 使用已连接的账号。"><select value={selectedProvider} disabled={disabled || localOnly} onChange={event => { setDataProvider(event.target.value as 'mcp' | 'redfox'); setAccountId(''); }}>{platformConnection.providers.map(item => <option key={item.id} value={item.id}>{item.name}{!item.supported ? ' · 暂未接入' : !item.configured ? ' · 待配置' : ''}</option>)}</select></Field>}{!redfoxData && <Field label="读取资料的账号" hint="账号决定登录与可读取范围，不会用此操作发布任何内容。"><select value={accountId} disabled={disabled || localOnly || !mcpAccounts.length} onChange={event => setAccountId(event.target.value)}><option value="">{platformConnection?.accountName ? `当前连接 · ${platformConnection.accountName}` : '使用当前平台连接'}</option>{mcpAccounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.configured ? '' : ' · 待配置'}</option>)}</select></Field>}</div>}
      {xhsMode && !redfoxData && platform === 'instagram' && <p className="info-box">Instagram 使用话题标签发现，建议输入 1–3 个实际标签名（不含 #）。能否取得热门标签内容取决于 MCP 与授权能力，不等同于全站关键词搜索。</p>}
      {xhsMode && !redfoxData && platform === 'tiktok' && <p className="info-box">当前适配的 TikTok 开源 MCP 不提供全站话题搜索，暂不能在这里发现他人的热门作品。账号连接与已有作品能力仍可在设置中查看；不会用空结果冒充热点。</p>}
      {xhsMode && <><div className="research-discovery-filters"><Field label="帖子时间范围"><select value={discovery.timeRange} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, timeRange: event.target.value as ResearchDiscovery['timeRange'] })}>{Object.entries(TIME_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="优先发现"><select value={discovery.sortBy} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, sortBy: event.target.value as ResearchDiscovery['sortBy'] })}>{Object.entries(SORT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="内容形式"><select value={discovery.noteType} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, noteType: event.target.value as ResearchDiscovery['noteType'] })}>{Object.entries(TYPE_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="分析使用的 DeepSeek"><select value={analysisModel} disabled={disabled || localOnly} onChange={event => setAnalysisModel(event.target.value)}>{deepseekModels.map(([value, model]) => <option key={value} value={value}>{model.label}</option>)}</select></Field></div><div className="research-discovery-connection"><div><Pill color={mcpReady ? 'green' : 'amber'}>{mcpReady ? `${platformName} · ${dataRouteName} 已配置` : `请检查${dataRouteName}配置`}</Pill><p>{redfoxData ? providerOption?.note || '通过 Redfox 读取公开内容，不使用平台登录账号。' : selectedAccount ? '使用你选定账号的本机连接，运行时会核对该账号的搜索能力与权限。' : platformConnection?.note || config?.mcpNote || '在“账号与发布”中启动对应 MCP，完成平台授权或登录，再检查连接。'}</p><button className="text-button" disabled={disabled} onClick={() => { if (redfoxData) openRedfoxSettings(go); else { settingsTab('publishing'); go('settings'); } }}>查看读取服务配置</button></div><div><Pill color={deepseekConfigured ? 'green' : 'amber'}>{deepseekConfigured ? '复用已保存的 DeepSeek 密钥' : '先保存 DeepSeek 密钥'}</Pill><p>关键词交给已选读取服务；本地清洗和筛选后，使用 DeepSeek 分析。Redfox 读取费用与文字模型费用分开记录。</p><button className="text-button" disabled={disabled} onClick={() => { settingsTab('models'); go('settings'); }}>设置 DeepSeek</button></div></div><p className="small-note">每次最多 3 个关键词，有限量读取详情；先核对主题，再在同一平台按单项指标排序。不代表全站热榜，播放、曝光和互动不能互换。</p></>}
      {!xhsMode && <><fieldset className="research-sources"><legend>选择来源</legend>{(['rss', 'web', 'xiaohongshu'] as const).map(source => <label key={source}><input type="checkbox" checked={sources.includes(source)} disabled={disabled || localOnly || source === 'web' && !config?.search.configured} onChange={() => setSources(toggle(sources, source) as ResearchSource[])}/><span><b>{SOURCE_NAMES[source]}</b><small>{source === 'web' ? config?.search.configured ? `使用 ${searchName}${config.search.provider === 'qwen' ? '，复用已有 Qwen 密钥' : ''}` : config?.search.provider === 'none' ? '可选：在设置中启用 Redfox、Qwen 或火山搜索' : searchOption?.note || '请先完成所选网页搜索服务的配置' : source === 'xiaohongshu' ? config?.mcpNote || (config?.mcpConfigured || config?.mcpSearchSupported ? 'MCP 已配置，运行时核对搜索能力' : '需先连接并检查 MCP，不会自动登录') : '默认推荐，无需搜索密钥；AI 分析仍按文字模型计费'}</small></span></label>)}</fieldset>
      <label className="research-semantic"><input type="checkbox" checked={useSemantic} disabled={disabled || localOnly || !settings.providers?.qwen?.configured} onChange={event => setUseSemantic(event.target.checked)}/><span>本次启用 Qwen 语义检索<small>默认使用本地关键词。启用后，参考摘要与检索问题会发送至阿里云生成向量，可能另计费；需要文字模型页已保存 Qwen 密钥。</small></span></label>
      <div className="research-budget"><span>原搜索 / 向量研究预算（不含 Redfox）：{live ? `${money(live.usageCny)} / ${money(live.budgetCny)} 已记录` : '每项目人民币 1 元，已用金额待读取'}</span><span>{sources.includes('web') ? `${searchName}：${money(reservation)} / 次，最多 ${maxRequests} 次，合计预留 ${money(maxRequests * reservation)}` : '本次不调用扩展网页搜索，搜索预留 ¥0'}</span></div>
      <p className="small-note">{useRedfoxSearch ? 'Redfox Kimi 联网直接使用你的关键词；搜索回答只作线索，原文和日期核实后才进入证据。Redfox 费用独立记录，不占旧研究实验预算。' : useQwenSearch ? `Qwen 联网直接使用你的关键词，省去查询规划调用；分析沿用 ${config?.models.analysis || settings.routes.analysis}。` : `文字规划与分析沿用 ${config?.models.query || settings.routes.classification} / ${config?.models.analysis || settings.routes.analysis}。`}文字模型费用计入原项目美元预算；搜索与可选向量费用以人民币单独记录，预留仅为本地估算，不是服务商实际收费上限。</p></>}
      </details>
      {redfoxXhsDiscovery && <div className="research-expansion"><label className="research-semantic"><input type="checkbox" checked={redfoxXhsExpansion} disabled={disabled || localOnly} onChange={event => setRedfoxXhsExpansion(event.target.checked)}/><span>允许补页和详情补全<small>仅用于本次新的小红书采集；重新分析已保存参考不会增加读取。</small></span></label><RedfoxXhsResearchLimit keywordCount={keywordList.length} expanded={redfoxXhsExpansion} timeRange={discovery.timeRange}/></div>}
      {xhsMode && !mcpReady && !localOnly && <p className="research-warning">所选 {dataRouteName} 尚未就绪，请展开上方设置核对读取服务。已保存的参考仍可查看和收藏。</p>}
      {!xhsMode && <p className="research-budget">费用：{activeSources.includes('web') ? `${searchName} 每次 ${money(reservation)}，最多 ${maxRequests} 次，搜索预留 ${money(reservation * maxRequests)}；` : '本次不使用付费网页搜索；'}{activeSemantic ? 'Qwen 语义检索另计费；' : ''}文字分析计入项目美元预算。搜索预留不代表实际收费上限，开始前仍会确认。</p>}
      {xhsMode && !redfoxXhsDiscovery && <p className="research-budget">本次使用 {settings.models[analysisModel]?.label || analysisModel} 分析，费用计入原项目美元预算。{redfoxData ? `Redfox 另按人民币记录：搜索每次 ${redfoxMoney(redfoxCosts?.searchCny)}，详情每次 ${redfoxMoney(redfoxCosts?.detailCny)}；每个关键词可能多次请求，按实际调用累计，以服务商账单为准。` : 'MCP 读取与本地筛选不调用模型；实际模型收费以 DeepSeek 账单为准。'}</p>}
      {!localOnly && (queryRequired && !queryConfigured || !analysisConfigured) && <div className="research-warning">{xhsMode ? '请先在文字模型设置保存 DeepSeek 密钥。新模式会使用这里选择的 DeepSeek，不会自动改用其他服务商。' : !analysisConfigured ? '请先配置参考分析使用的文字模型（沿用“评论复盘”分工）。' : '当前来源需要查询规划模型，请配置文字模型中的“评论分类”分工。'}<button className="text-button" onClick={() => { settingsTab('models'); go('settings'); }}>前往文字模型设置</button></div>}
      {!xhsMode && remaining === 0 && <p className="research-warning">原搜索 / 向量研究预算已用尽。可关闭语义检索，并使用 RSS 或已保存参考；Redfox 独立计费，不受此预算控制，文字分析仍按项目美元预算计费。</p>}
      <div className="research-actions"><button className="button primary" disabled={disabled || !canRun || remaining === 0 && (!useRedfoxSearch && activeSources.includes('web') || activeSemantic)} onClick={() => setConfirming('collect')}><Search size={16}/>{xhsMode ? '查找帖子并分析' : '研究近七天内容'}</button>{reusableCount > 0 && <button className="button" disabled={disabled || !canReuse || activeSemantic && remaining === 0} onClick={() => setConfirming('reuse')}>仅重新分析已保存参考</button>}{!xhsMode && <button className="button" disabled={disabled} onClick={() => { settingsTab('research'); go('settings'); }}>配置联网检索</button>}<button className="text-button" disabled={disabled || connection.loading} onClick={() => void connection.reload()}><RefreshCw size={14}/>刷新连接状态</button><small>{keywordList.length}/{keywordLimit} 个关键词</small></div>
    </section>
    {project.redfoxWebSearch && ['pending', 'submitting', 'uncertain', 'failed'].includes(project.redfoxWebSearch.status) && <div className="panel"><h3>Redfox 联网搜索任务</h3><p className="small-note">状态：{project.redfoxWebSearch.status === 'pending' ? '等待结果' : ['uncertain', 'submitting'].includes(project.redfoxWebSearch.status) ? '提交结果待核对' : '任务未完成'}{project.redfoxWebSearch.taskId ? ` · 任务编号 ${project.redfoxWebSearch.taskId}` : ''}。使用相同关键词继续研究会优先查询原任务；解除锁定后再次运行会新提交并收费。</p><label className="checkbox-row"><input type="checkbox" checked={resetSearch} disabled={disabled} onChange={event => setResetSearch(event.target.checked)}/>我已在服务商核对旧任务，了解重新提交会单独计费。</label><button className="button" disabled={disabled || !resetSearch} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/research/redfox-search-reset`, 'POST', { confirmed: true }); setResetSearch(false); notify('搜索锁定已解除，下次研究会提交新任务。'); })}>已核对服务商，解除搜索锁定</button></div>}
    {(current.run || statusError || running) && <section className="panel research-progress" aria-live="polite"><div className="section-heading"><h3>{running ? <Loader2 size={17} className="spin"/> : <Check size={17}/>} {pending && current.run?.status !== 'running' ? '正在提交本次研究' : PHASES[current.run?.phase || 'query'] || '正在整理研究记录'}</h3><button className="text-button" disabled={localOnly || !config?.available} onClick={() => void readStatus()}><RefreshCw size={14}/>刷新进度</button></div><p>{current.run ? `开始 ${date(current.run.startedAt)}${current.run.finishedAt ? ` · 完成 ${date(current.run.finishedAt)}` : ''}` : '请求已提交，等待本机处理。'}</p>{current.run?.error && <p className="research-warning" role="alert">{current.run.error} 已保存的历史参考不会因失败清空。</p>}{statusError && <p className="research-warning">状态读取未完成：{statusError}</p>}{pollPaused && <p className="small-note">自动刷新已暂缓，可稍后点击“刷新进度”。刷新不会重新发起研究。</p>}</section>}
    <section className="research-results" aria-label="研究分析结果"><div className="section-heading"><div><h2>证据与创作切入点</h2><p className="muted">观察来自原始资料，吸引点属于待验证假设。跨平台不比较绝对互动量，热度也不等于转化。</p></div><span className="muted">已选 {chosen.length}/5</span></div>
      <ResearchRunSummary research={current}/>
      {current.retrieval?.comparison && <div className="panel research-comparison" aria-label="已保存参考样本口径"><b>已保存参考：{PLATFORM_NAMES[current.retrieval.comparison.platform]} · {current.retrieval.comparison.related} 条同话题候选</b><p>其中 {current.retrieval.comparison.knownMetrics} 条提供{METRIC_NAMES[current.retrieval.comparison.metric] || current.retrieval.comparison.metric}数据，{current.retrieval.comparison.unknownMetrics} 条未提供；{current.retrieval.comparison.unrelated} 条尚未核对主题关联，不进入 AI 分析。</p><p className="small-note">{current.retrieval.comparison.sampleMedian === null ? '有数据的样本不足 5 条，暂不建立热度基线。' : `可见指标中位数 ${current.retrieval.comparison.sampleMedian.toLocaleString('zh-CN')}，仅作样本内参考；不代表行业基准。`} 一次采集不能判断增长速度，AI 会给出待验证的吸引点与可执行测试。</p></div>}
      {current.run && <p className="small-note research-saved-scope">最近研究请求：{current.run.discovery ? `${PLATFORM_NAMES[current.run.discovery.platform || 'xiaohongshu']} · ${TIME_NAMES[current.run.discovery.timeRange]} · ${SORT_NAMES[current.run.discovery.sortBy]} · ${TYPE_NAMES[current.run.discovery.noteType]}` : '近期热点与网页 · 近七天'}{current.run.analysisModel ? ` · ${settings.models[current.run.analysisModel]?.label || current.run.analysisModel}` : ''}。{current.run.status === 'failed' ? '本次请求未完成，旧分析和已选参考保留；帖子列表还可能包含本轮已采集的资料。' : current.run.status === 'running' ? '本次仍在进行，下方保留旧分析，并逐步保存本轮资料。' : '更改上方选项后，需重新开始研究才会更新这里的结果。'}</p>}
      {current.references.some(reference => reference.kind in PLATFORM_NAMES) && <ReferenceCollection key={`social:${project.id}:${current.run?.id || 'saved'}`} title="发现的同话题内容" references={current.references.filter(reference => reference.kind in PLATFORM_NAMES)}/>}
      {(current.reports.length > 0 || current.queries.length > 0) && <details className="panel research-coverage" open={current.reports.some(report => report.status === 'failed') || undefined}><summary>查看本次查询、来源覆盖与检索方式</summary>{current.queries.length > 0 && <div className="research-tags">{current.queries.map(query => <span key={query}>{query}</span>)}</div>}<div className="research-reports">{current.reports.map((report, index) => <ResearchSourceReport key={`${report.sourceId}:${index}`} report={report}/>)}</div><p className="small-note">已保存参考的检索方式：{current.retrieval?.method === 'hybrid' || current.retrieval?.method === 'semantic' ? 'Qwen 语义与本地关键词' : current.retrieval?.method === 'sample-interaction' ? '本地关键词与可见互动排序' : current.retrieval?.method === 'recent-candidates' ? '近期候选回退（无关键词命中）' : current.retrieval?.method === 'keyword' ? '本地关键词' : '检索方式未记录'}{current.retrieval ? ` · ${current.retrieval.count} 条参考` : ''}。{current.retrieval?.note ? `${current.retrieval.note} ` : ''}仅覆盖来源可读取且符合所选范围的样本；失败后可能保留历史检索结果。不限时间可以保留历史帖子，日期仍需核实。发布时间与采集时间分别记录，判断增长速度需要至少两次采样。</p></details>}
      {!!current.pendingReferences?.length && <details className="panel research-coverage research-pending"><summary>待核实线索 · {current.pendingReferences.length} 条</summary><p className="small-note">这些链接未满足本次原文、日期或来源核验条件，没有进入分析。联网模型的回答不作为原文证据。</p><ul>{current.pendingReferences.map((reference, index) => { const url = safeURL(reference.url), summary = (reference as typeof reference & {text?: string}).text; return <li key={`${reference.url}:${index}`}>{url ? <a href={url} target="_blank" rel="noreferrer">{reference.title || '查看来源链接'} <ExternalLink size={12}/></a> : <b>{reference.title || '来源链接不可用'}</b>}<p>{reference.reason || '原文或发布日期尚未核实'}</p>{summary && <p>保留的搜索摘要：{summary}</p>}<ResearchReferenceImages reference={reference}/></li>; })}</ul></details>}
      {current.analyses.length ? <div className="research-analysis-grid">{current.analyses.map(analysis => <AnalysisCard key={analysis.id} analysis={analysis} references={current.references} chosen={chosen.includes(analysis.id)} acknowledged={ack.includes(analysis.id)} disabled={disabled || localOnly || !config?.available} full={chosen.length >= 5} onChoose={() => setChosen(toggle(chosen, analysis.id))} onAcknowledge={() => setAck(toggle(ack, analysis.id))}/>)}</div> : <div className="panel"><Empty title={current.run?.status === 'failed' ? '本次研究未完成，请查看上方具体原因' : current.run?.status === 'completed' ? '本次没有足够证据形成参考' : '先设置范围，再开始研究'} text="有出处和可核对原文、符合所选范围的内容才进入参考分析；没有适合结果时不会编造热点。"/></div>}
      {current.analyses.length > 0 && <div className="panel research-selection"><p>{riskPending ? '请逐项核对并确认已选参考的名称与素材使用风险。' : '只把你确认的参考和标签带入后续创作，不会替代项目事实。最多选择 5 项，也可清空选择。'}</p><button className="button primary" disabled={disabled || localOnly || !config?.available || !selectionChanged || riskPending} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/research/select`, 'POST', { expectedRevision: current.revision, analysisIds: chosen, acknowledgedIds: ack.filter(id => chosen.includes(id)), confirmed: true }); await readStatus(); notify(chosen.length ? '创作参考已保存，后续生成会带入已选参考' : '已清空本次创作参考选择'); })}><Check size={16}/>确认创作参考</button></div>}
      {current.references.some(reference => !(reference.kind in PLATFORM_NAMES)) && <ReferenceCollection key={`web:${project.id}:${current.run?.id || 'saved'}`} title="网页与新闻参考库" web references={current.references.filter(reference => !(reference.kind in PLATFORM_NAMES))}/>}
    </section>
    <section className="panel research-selected"><div className="section-heading"><div><h2>带着参考，开始创作</h2><p className="muted">先保存本轮参考，再带入新内容。后续研究不会覆盖这份已保存的资料。</p></div></div>{selected.length ? <><p className="small-note">采用：{selected.map(item => item.title).join('、')}</p><div className="research-tags">{[...new Set(selected.flatMap(item => item.tags))].map(tag => <span key={tag}><Tag size={13}/>{tag}</span>)}</div><KnowledgeActions disabled={disabled} actions={['create','reference']} source={{title:`${selected[0].title}${selected.length > 1 ? `等 ${selected.length} 项参考` : ''}`,text:selected.map(item=>[item.title,`观察：${item.observation}`,`待验证假设：${item.hypothesis}`,`可尝试：${item.application}`,`局限：${item.limitations}`, ...item.evidence.map(e=>{const ref=current.references.find(r=>r.id===e.referenceId);return `引用：${e.quote}${ref ? `\n${ref.title}\n${ref.url}` : ''}`;})].join('\n')).join('\n\n'),sourceId:current.run?.id || '',sourceType:'research-selection',platform:selected[0].discovery?.platform}}/></> : <p className="small-note">尚未确认创作参考。可直接使用上方单条建议，或挑选后确认本轮参考。</p>}</section>
    {confirming && <Modal title={confirming === 'reuse' ? '重新分析已保存参考' : xhsMode ? `确认${platformName}同话题研究` : '确认本次联网研究'} description={confirming === 'reuse' ? '复用本机参考，重新核对范围、检索与分析，不重新采集。' : '确认后才会搜索并调用模型，不会自动发布任何内容。'} onClose={() => { if (!disabled) setConfirming(null); }}><div className="research-consent">
      <p><b>范围：</b>{xhsMode ? `${TIME_NAMES[discovery.timeRange]} · ${SORT_NAMES[discovery.sortBy]} · ${TYPE_NAMES[discovery.noteType]}` : '近七天'}；{keywordList.join('、')}；来源 {activeSources.map(source => SOURCE_NAMES[source]).join('、')}。</p>
      {xhsMode && !redfoxData && confirming !== 'reuse' && <p><b>读取账号：</b>{selectedAccount?.name || platformConnection?.accountName || '当前平台连接'}。采集任务会固定这个账号，读取记录保留账号归属；账号名称不会发送给分析模型。</p>}
      <p>{xhsMode ? `${confirming === 'reuse' ? `仅复用本机已保存的${platformName}内容，并按所选时间范围与内容形式重新筛选。` : `你的关键词交给${platformName} ${dataRouteName}，读取其支持范围内的内容详情。`}本地清洗后的同话题短摘录、已取得的指标与必要项目资料会发送给 ${settings.models[analysisModel]?.label || analysisModel}，生成改进建议与验证方式。参考库保存在本机。` : confirming === 'reuse' ? '本次不进行 AI 扩词和网络采集。已保存参考中的短摘录、公开数据与必要项目资料仍会发送给分析模型，过期来源将重新筛除。' : useRedfoxSearch ? '你的关键词会发送给 Redfox Kimi 联网搜索，返回链接将核对正文与发布日期。搜索回答只作线索，不作为原文证据；分析仍使用已选文字模型。' : useQwenSearch ? '你的关键词会直接发送给 Qwen 联网模型，随后按返回链接读取原文；模型回答不作为原文证据。仅将核实正文与发布日期的近七天资料交给分析模型，未核实链接单独保留。清洗与参考库保存在本机。' : '项目关键词与必要项目资料会发送给查询规划模型；查询词会发送给所选来源，获取的短摘录及公开互动数据再交给分析模型。清洗与参考库保存在本机。'}</p>
      {!xhsMode && confirming !== 'reuse' && queryRequired && <WorkflowSkillSummary workflowId="research-query" disabled={disabled} onManage={() => { setConfirming(null); settingsTab('skills'); go('settings'); }}/>} 
      {!xhsMode && confirming !== 'reuse' && useQwenSearch && activeSources.includes('web') && <WorkflowSkillSummary workflowId="web-search" disabled={disabled} onManage={() => { setConfirming(null); settingsTab('skills'); go('settings'); }}/>} 
      <WorkflowSkillSummary workflowId="research-analysis" disabled={disabled} onManage={() => { setConfirming(null); settingsTab('skills'); go('settings'); }}/>
      {activeSemantic && <p>本次已勾选语义检索：参考摘要和检索问题还会发送给阿里云 Qwen，生成向量索引并用于检索。</p>}
      {redfoxXhsDiscovery && confirming !== 'reuse' ? <RedfoxXhsResearchLimit keywordCount={keywordList.length} expanded={redfoxXhsExpansion} timeRange={discovery.timeRange}/> : <p><b>费用：</b>{xhsMode ? `${confirming === 'reuse' ? '本次不新增平台读取费用；' : ''}${redfoxData && confirming !== 'reuse' ? `Redfox 搜索每次 ${redfoxMoney(redfoxCosts?.searchCny)}，详情每次 ${redfoxMoney(redfoxCosts?.detailCny)}，可能多次调用，按实际次数累计，独立计入人民币费用；` : ''}所选 DeepSeek 分析计入项目美元预算。最终费用以各服务商账单为准。` : <>{confirming === 'reuse' ? '本次不新增网页搜索费用和查询规划费用。' : sources.includes('web') ? `${searchName} 最多 ${maxRequests} 次请求，每次按 ${money(reservation)} 估算，合计预留 ${money(maxRequests * reservation)}；预留不是服务商实际收费上限。` : '本次未选择付费网页搜索。'}{activeSemantic ? '向量请求另按用量记录。' : ''} {useRedfoxSearch ? 'Redfox 搜索独立计人民币费用，不占旧研究实验预算；Qwen 向量仍使用原预算。' : '搜索与向量共用本项目人民币 1 元实验预算。'}文字模型另计项目美元预算，最终账单以服务商为准。</>}</p>}
      {confirming !== 'reuse' && (xhsMode || activeSources.includes('xiaohongshu')) && <p>{xhsMode ? '每轮最多 3 个关键词，按来源能力有限量读取详情，最多 10 条同话题内容进入分析。' : '小红书最多 2 次搜索、8 条详情。'}可读取范围取决于所选服务能力与可用权限，不保证完整覆盖所选时段或全站。缺失指标保留为空，高互动只代表本次返回样本中的表现。</p>}
      <div className="modal-actions"><button className="button" disabled={disabled} onClick={() => setConfirming(null)}>取消</button><button className="button primary" disabled={disabled || !(confirming === 'reuse' ? canReuse : canRun) || remaining === 0 && (activeSemantic || confirming !== 'reuse' && !useRedfoxSearch && activeSources.includes('web'))} onClick={start}>{confirming === 'reuse' ? '确认传输并重新分析' : '确认传输并开始研究'}</button></div>
    </div></Modal>}
  </div>;
}

