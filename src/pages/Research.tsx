import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ExternalLink, KeyRound, Loader2, RefreshCw, Search, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { Empty, Field, Modal, Pill } from '../components';
import { useStudio } from '../context';
import { canGenerate } from '../model-provider';
import type { ResearchAnalysis, ResearchDiscovery, ResearchGrowthAdvice, ResearchMetric, ResearchPlatform, ResearchReference, ResearchSearchProvider, ResearchSettingsState, ResearchSource, ResearchState, ResearchStatus } from '../types';
import '../research.css';

const EMPTY: ResearchState = { revision: 0, queries: [], references: [], analyses: [], selectedIds: [], reports: [] };
const PHASES: Record<string, string> = { query: 'AI 整理检索问题', search: '读取所选来源', clean: '清洗与核对发布日期', retrieve: '检索相关参考', analyze: 'AI 分析证据与切入点', completed: '本次研究完成', failed: '本次研究未完成' };
const SOURCE_NAMES: Record<ResearchSource, string> = { web: '扩展网页搜索', xiaohongshu: '小红书 MCP', douyin: '抖音 MCP', tiktok: 'TikTok MCP', youtube: 'YouTube MCP', instagram: 'Instagram MCP', rss: '公开中文新闻' };
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
function settingsTab(section: 'research' | 'models' | 'publishing' | 'rules') { try { sessionStorage.setItem('studio-settings-section', section); } catch { /* navigation remains available */ } }

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
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function ResearchSettings({ onOpenSettings }: { onOpenSettings: (section: 'models' | 'publishing') => void }) {
  const { settings, busy, run, notify } = useStudio();
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  const { data, loading, error, reload } = useResearchConnection(localOnly);
  const [provider, setProvider] = useState<ResearchSearchProvider>('none'), [key, setKey] = useState(''), [reservation, setReservation] = useState('0.02'), [clearOpen, setClearOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const options = data?.search.providers || [], selected = options.find(option => option.id === provider), volcano = options.find(option => option.id === 'volcengine');
  useEffect(() => { if (data) { setProvider(data.search.provider); setReservation(String(data.search.providers.find(option => option.id === 'volcengine')?.reservationCny ?? .02)); } }, [data]);
  const amount = Number(reservation), validAmount = Number.isFinite(amount) && amount > 0 && amount <= 1;
  const providerChanged = !!data && provider !== data.search.provider;
  const keyChanged = !!key.trim() || !!volcano && amount !== volcano.reservationCny;
  const saveProvider = () => void run(async () => { await api('/research/settings', 'PUT', { provider }); await reload(); notify('搜索方式已保存；切换不会删除原来的密钥'); });
  return <section className="panel research-settings" aria-label="联网检索设置">
    <div className="section-heading"><div><h2><Search size={19}/>选择适合你的研究方式</h2><p className="muted">同话题内容研究复用平台 MCP 和 DeepSeek。公开新闻无需搜索密钥，网页扩展服务可以按需选择。</p></div><Pill color={data?.search.provider === 'none' ? 'gray' : data?.search.configured ? 'green' : 'amber'}>{data?.search.provider === 'none' ? '无需新增搜索密钥' : data?.search.configured ? '已保存搜索配置' : '按需连接'}</Pill></div>
    {localOnly ? <p className="info-box">此版本暂不运行联网研究，也不接收搜索密钥。请使用 Windows 版的加密本地工作区；已有新闻线索与标签可继续使用。</p> : <>
      {loading && <p className="small-note" role="status">正在读取搜索配置…</p>}
      {error && <div className="research-error" role="alert">{error}<button type="button" className="text-button" disabled={loading} onClick={() => void reload()}>重新读取配置</button></div>}
      {data && (!data.available ? <p className="info-box">联网研究目前需要 Windows 版的加密本地用户工作区，当前环境暂不开放此入口。</p> : <>
        <div className="research-start-note"><b>先用已有配置开始</b><p>在“热点与灵感”选择同话题模式，连接支持搜索的平台 MCP 并保存 DeepSeek 密钥即可开始。下面的网页搜索设置只用于“近期热点与网页”模式；公开新闻采集无需搜索 API Key，AI 分析仍按模型用量计费。</p></div>
        <fieldset className="research-provider-options"><legend>是否增加网页搜索？</legend>{options.map(option => <label key={option.id} className={provider === option.id ? 'selected' : ''}><input type="radio" name="research-search-provider" value={option.id} checked={provider === option.id} disabled={busy || !data.search.editable} onChange={() => { setProvider(option.id); setKey(''); if (option.id === 'volcengine' && !option.configured) setAdvanced(true); }}/><span><b>{option.name}</b><small>{option.id === 'none' ? '先用公开新闻，无需额外密钥' : option.id === 'qwen' ? '复用文字模型中的 Qwen 密钥，无需再填' : '使用这个搜索产品的独立密钥'}</small><em>{option.id === 'none' ? '默认推荐' : !option.supported ? '当前配置不支持' : option.configured ? '已保存配置' : '待配置'}</em></span></label>)}</fieldset>
        {selected && <div className="research-provider-detail"><p>{selected.note}</p>{provider === 'qwen' && <><p className="small-note">这里不会要求第二份 Qwen 密钥。每次研究最多 {selected.maxRequests} 次联网请求，单次按 {money(selected.reservationCny)} 估算预留，包括联网模型与搜索服务；这是本地预算估算，并非服务商实际收费上限。</p><button className="button small" disabled={busy} onClick={() => onOpenSettings('models')}>{selected.configured ? '查看已有 Qwen 配置' : '前往文字模型配置 Qwen'}</button></>}{provider === 'none' && <button className="text-button" disabled={busy} onClick={() => onOpenSettings('models')}>查看已有文字模型</button>}</div>}
        <div className="research-actions"><button className="button primary" disabled={busy || !data.search.editable || !providerChanged} onClick={saveProvider}><Check size={16}/>保存搜索方式</button><small>{providerChanged ? '当前选择尚未保存，研究仍使用上次保存的方式。' : '切换方式会保留已有密钥，不会自动发起搜索。'}</small></div>
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
        <details className="research-advanced research-models"><summary>查看模型分工、其他来源与费用</summary><dl><div><dt>检索问题规划</dt><dd>{data.search.provider === 'qwen' ? 'Qwen 联网直接使用你的关键词，省去一次扩词调用' : `${data.models.query} · 沿用已有文字模型`}</dd></div><div><dt>参考分析</dt><dd>{data.models.analysis} · 沿用已有文字模型</dd></div><div><dt>参考库检索</dt><dd>默认本地关键词；可选已配置的 Qwen 语义检索</dd></div><div><dt>小红书来源</dt><dd>{data.mcpNote || '在账号与发布中连接并检查 MCP 搜索能力'}</dd></div></dl><p className="small-note">文字模型计入项目美元预算；扩展搜索与可选向量请求共用每项目人民币 1 元研究实验预算。未选择的搜索服务不会调用，也不会自动切换收费服务。</p><div className="research-actions"><button className="button small" onClick={() => onOpenSettings('models')}>设置文字模型</button><button className="button small" onClick={() => onOpenSettings('publishing')}>检查平台连接</button></div></details>
      </>)}
    </>}
    {clearOpen && <Modal title="删除火山搜索密钥" description="仅删除本机保存的火山搜索密钥，当前搜索方式不变。Qwen 密钥和已保存参考仍保留。" onClose={() => { if (!busy) setClearOpen(false); }}><div className="modal-actions"><button className="button" disabled={busy} onClick={() => setClearOpen(false)}>保留</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await api('/research/settings', 'PUT', { clearKey: true }); setClearOpen(false); await reload(); notify('火山搜索密钥已从本机删除'); })}>确认删除火山搜索密钥</button></div></Modal>}
  </section>;
}

function metricLabel(metric?: ResearchMetric) {
  if (!metric || metric.value === null || !Number.isFinite(metric.value)) return metric?.raw ? `未核实（原始 ${metric.raw}）` : '未提供';
  return `${metric.approximate ? '约 ' : ''}${metric.value.toLocaleString('zh-CN')}${metric.approximate && metric.raw ? `（${metric.raw}）` : ''}`;
}
function ReferenceCard({ reference, quote }: { reference: ResearchReference; quote?: string }) {
  const url = safeURL(reference.url);
  const excerpt = Array.from(reference.text || ''), truncated = excerpt.length > 220;
  const basis: Record<string, string> = { page: '网页发布日期', detail: '详情页时间', rss: 'RSS 发布时间', publishedAt: '来源发布时间', note_time: '笔记详情时间', 'search-metadata': '搜索服务提供的发布时间（尚未逐页核对）', 'platform-timestamp': '平台详情页发布时间', 'publisher-feed': '新闻订阅源发布时间', 'page-published-metadata': '原文网页提供的发布日期' };
  return <article className="research-reference">
    <div>{reference.topicRanking?.sampleRank ? <span className="research-sample-rank">同话题样本 #{reference.topicRanking.sampleRank}</span> : reference.discoveryRanking && <span className="research-sample-rank">样本 #{reference.discoveryRanking.sampleRank}</span>}<b>{reference.title}</b>{url && <a href={url} target="_blank" rel="noreferrer">核对原文 <ExternalLink size={12}/></a>}</div>
    <p className="research-source-meta">{reference.sourceName || SOURCE_NAMES[reference.kind]}{reference.kind in PLATFORM_NAMES ? ` · ${reference.noteType === 'image' ? '图文' : reference.noteType === 'video' ? '视频' : '形式未核实'}` : ''} · 发布 {date(reference.publishedAt)} · 采集 {date(reference.collectedAt)}</p>
    <p className="small-note">日期依据：{basis[reference.dateBasis] || (/[\u4e00-\u9fff]/.test(reference.dateBasis) ? reference.dateBasis : '来源提供的发布时间，尚需核对')}</p>
    {quote && <blockquote>{quote}</blockquote>}
    {!quote && <><p>{truncated ? `${excerpt.slice(0, 220).join('')}…` : reference.text}</p>{truncated && <details className="research-full-excerpt"><summary>查看完整摘录</summary><p>{reference.text}</p></details>}</>}
    <dl className="research-metrics">{METRICS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{metricLabel(reference.metrics?.[key])}</dd></div>)}</dl>
    {reference.topicRanking && <p className="small-note">{reference.topicRanking.relevant ? `命中：${reference.topicRanking.matchedKeywords.join('、')} · 按${METRIC_NAMES[reference.topicRanking.metric] || reference.topicRanking.metric}比较 ${reference.topicRanking.knownSamples} 条有数据的同话题样本。${reference.topicRanking.value === null ? '此指标未提供，不能据此判断高流量。' : reference.topicRanking.knownSamples < 5 ? '样本少于 5 条，暂不建立热度基线。' : '只是当前采集样本中的表现，不是平台排名。'}` : '尚未核对主题关联 · 已保留供查看，不送入本轮 AI 分析。可添加同义词后重新采集。'}</p>}
    {reference.sourceAccountName && <p className="small-note">采集连接：{reference.sourceAccountName}。这是读取资料的账号，不代表内容作者。</p>}
    {reference.discoveryRanking && <p className="small-note">{SORT_NAMES[reference.discoveryRanking.sortBy]} · 命中关键词：{reference.discoveryRanking.matchedKeywords.join('、') || '待核对关联'}。只在本次可读取样本中比较；未提供的指标不按 0 计算。</p>}
    <p className="small-note">{reference.riskReason || '名称及素材的使用权利尚未核实，请核对适用条件。'}</p>
  </article>;
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
  </article>;
}

export function ResearchPanel() {
  const { project, settings, busy, run, runBackground, mutate, refresh, notify, go } = useStudio();
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  const connection = useResearchConnection(localOnly);
  const [live, setLive] = useState<ResearchStatus | null>(null), [statusError, setStatusError] = useState('');
  const [keywords, setKeywords] = useState(project?.brief.product.slice(0, 30) || '');
  const [mode, setMode] = useState<'xiaohongshu' | 'web'>(project?.research?.run && !project.research.run.discovery ? 'web' : 'xiaohongshu');
  const [discovery, setDiscovery] = useState<ResearchDiscovery>(project?.research?.run?.discovery || DEFAULT_DISCOVERY);
  const [accountId, setAccountId] = useState('');
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
  const selectedAccount = platformConnection?.accounts.find(account => account.id === accountId);
  const activeSemantic = !xhsMode && useSemantic, keywordLimit = xhsMode ? 3 : 8;
  const activeSources: ResearchSource[] = xhsMode ? [platform] : sources;
  const deepseekModels = Object.entries(settings.models).filter(([, model]) => model.provider === 'deepseek');
  const deepseekConfigured = config?.deepseekConfigured ?? !!settings.providers?.deepseek?.configured;
  const queryConfigured = canGenerate(settings, 'classification'), analysisConfigured = xhsMode ? deepseekConfigured && settings.models[analysisModel]?.provider === 'deepseek' : canGenerate(settings, 'analysis');
  const useQwenSearch = !xhsMode && sources.includes('web') && config?.search.provider === 'qwen';
  const queryRequired = !xhsMode && !useQwenSearch;
  const valid = keywordList.length >= 1 && keywordList.length <= keywordLimit && keywordList.every(word => word.length <= 30) && activeSources.length > 0;
  const mcpReady = platformConnection ? platform !== 'tiktok' && (selectedAccount ? selectedAccount.configured : platformConnection.supported && platformConnection.configured) : platform === 'xiaohongshu' && !!config?.mcpConfigured && config.mcpSearchSupported !== false;
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
    try { await mutate(`/projects/${project.id}/research/run`, 'POST', { keywords: keywordList, sources: activeSources, expectedRevision: current.revision, confirmed: true, useSemantic: activeSemantic, reuseCollected, ...(xhsMode ? { discovery, analysisModel, ...((accountId || platformConnection?.accountId) ? { accountId: accountId || platformConnection?.accountId } : {}) } : {}) }); await readStatus(); notify(xhsMode ? '同话题内容与分析已保存，请核对建议并挑选创作参考' : '近期内容研究已保存，请核对证据后挑选创作参考'); }
    finally { if (mounted.current) setPending(false); await readStatus(); }
  }); };
  return <div className="research-workspace">
    <div className="research-mode-switch" role="group" aria-label="选择研究方式"><button type="button" aria-pressed={xhsMode} className={xhsMode ? 'selected' : ''} disabled={disabled} onClick={() => setMode('xiaohongshu')}><b>同话题高表现内容</b><span>找相关内容 → 核对表现 → 拆解与试验</span></button><button type="button" aria-pressed={!xhsMode} className={!xhsMode ? 'selected' : ''} disabled={disabled} onClick={() => setMode('web')}><b>近期热点与网页</b><span>公开新闻与网页 → 核对来源 → 提取参考</span></button></div>
    <ol className="research-steps"><li><span>1</span><div><b>设置研究范围</b><small>关键词、来源、费用</small></div></li><li><span>2</span><div><b>核对证据与分析</b><small>观察、假设、原始数据</small></div></li><li><span>3</span><div><b>挑选后用于创作</b><small>标签、事实、写作 Skills</small></div></li></ol>
    <section className="panel research-scope" aria-label="内容研究设置"><div className="section-heading"><div><h2><Search size={19}/>{xhsMode ? `找到值得参考的${platformName}内容` : '近七天内容研究'}</h2><p className="muted">{xhsMode ? '先找同话题，再比较真实可见指标，分析可能的吸引点并形成创作实验。' : '寻找相关内容与可验证的切入点，不把搜索结果直接称为“爆款”。'}</p></div><Pill color="gray">手动触发</Pill></div>
      {localOnly ? <p className="info-box">当前版本暂不运行联网研究，请使用 Windows 版的加密本地工作区。已有参考可查看，原有 RSS 新闻功能保留在下方。</p> : connection.loading ? <p className="small-note">正在读取研究连接配置…</p> : connection.error ? <div className="research-error" role="alert">{connection.error}<button className="text-button" onClick={() => void connection.reload()}>重试读取配置</button></div> : !config?.available ? <p className="info-box">联网研究需要 Windows 版的加密本地用户工作区。</p> : null}
      <Field label={xhsMode ? '要找的主题或关键词' : '这次要研究的项目关键词'} hint={`1–${keywordLimit} 个，每个最多 30 字，用逗号分隔。建议填写受众、使用场景和具体需求。`}><textarea rows={2} maxLength={260} value={keywords} disabled={disabled || localOnly} onChange={event => setKeywords(event.target.value)} placeholder="例如：学习搭子，大学生自习，校园社交"/></Field>
      {keywordList.length > keywordLimit && <p className="research-warning">当前方式最多支持 {keywordLimit} 个关键词，请减少后再开始。</p>}
      {xhsMode && <div className="research-discovery-filters"><Field label="研究平台" hint="每轮研究一个平台，避免混合不同平台的计数口径。"><select value={platform} disabled={disabled || localOnly} onChange={event => { const next = event.target.value as ResearchPlatform; setDiscovery({ ...discovery, platform: next, sortBy: 'general', noteType: next === 'youtube' ? 'video' : 'all' }); setAccountId(''); }}>{Object.entries(PLATFORM_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="读取资料的账号" hint="账号决定登录与可读取范围，不会用此操作发布任何内容。"><select value={accountId} disabled={disabled || localOnly || !platformConnection?.accounts.length} onChange={event => setAccountId(event.target.value)}><option value="">{platformConnection?.accountName ? `当前连接 · ${platformConnection.accountName}` : '使用当前平台连接'}</option>{platformConnection?.accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.configured ? '' : ' · 待配置'}</option>)}</select></Field></div>}
      {xhsMode && platform === 'instagram' && <p className="info-box">Instagram 使用话题标签发现，建议输入 1–3 个实际标签名（不含 #）。能否取得热门标签内容取决于 MCP 与授权能力，不等同于全站关键词搜索。</p>}
      {xhsMode && platform === 'tiktok' && <p className="info-box">当前适配的 TikTok 开源 MCP 不提供全站话题搜索，暂不能在这里发现他人的热门作品。账号连接与已有作品能力仍可在设置中查看；不会用空结果冒充热点。</p>}
      {xhsMode && <><div className="research-discovery-filters"><Field label="帖子时间范围"><select value={discovery.timeRange} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, timeRange: event.target.value as ResearchDiscovery['timeRange'] })}>{Object.entries(TIME_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="优先发现"><select value={discovery.sortBy} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, sortBy: event.target.value as ResearchDiscovery['sortBy'] })}>{Object.entries(SORT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="内容形式"><select value={discovery.noteType} disabled={disabled || localOnly} onChange={event => setDiscovery({ ...discovery, noteType: event.target.value as ResearchDiscovery['noteType'] })}>{Object.entries(TYPE_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="分析使用的 DeepSeek"><select value={analysisModel} disabled={disabled || localOnly} onChange={event => setAnalysisModel(event.target.value)}>{deepseekModels.map(([value, model]) => <option key={value} value={value}>{model.label}</option>)}</select></Field></div><div className="research-discovery-connection"><div><Pill color={mcpReady ? 'green' : 'amber'}>{mcpReady ? `${platformName} MCP 已配置` : `先连接${platformName} MCP`}</Pill><p>{selectedAccount ? '使用你选定账号的本机连接，运行时会核对该账号的搜索能力与权限。' : platformConnection?.note || config?.mcpNote || '在“账号与发布”中启动对应 MCP，完成平台授权或登录，再检查连接。'}</p><button className="text-button" disabled={disabled} onClick={() => { settingsTab('publishing'); go('settings'); }}>打开平台连接引导</button></div><div><Pill color={deepseekConfigured ? 'green' : 'amber'}>{deepseekConfigured ? '复用已保存的 DeepSeek 密钥' : '先保存 DeepSeek 密钥'}</Pill><p>关键词交给已选平台 MCP；本地清洗和筛选后，仅使用 DeepSeek 分析，不要求额外搜索或向量密钥。</p><button className="text-button" disabled={disabled} onClick={() => { settingsTab('models'); go('settings'); }}>设置 DeepSeek</button></div></div><p className="small-note">每次最多 3 个关键词，有限量读取详情；先核对主题，再在同一平台按单项指标排序。不代表全站热榜，播放、曝光和互动不能互换。</p></>}
      {!xhsMode && <><fieldset className="research-sources"><legend>选择来源</legend>{(['rss', 'web', 'xiaohongshu'] as const).map(source => <label key={source}><input type="checkbox" checked={sources.includes(source)} disabled={disabled || localOnly || source === 'web' && !config?.search.configured} onChange={() => setSources(toggle(sources, source) as ResearchSource[])}/><span><b>{SOURCE_NAMES[source]}</b><small>{source === 'web' ? config?.search.configured ? `使用 ${searchName}${config.search.provider === 'qwen' ? '，复用已有 Qwen 密钥' : ''}` : config?.search.provider === 'none' ? '可选：在联网检索设置中启用 Qwen 或火山搜索' : searchOption?.note || '请先完成所选网页搜索服务的配置' : source === 'xiaohongshu' ? config?.mcpNote || (config?.mcpConfigured || config?.mcpSearchSupported ? 'MCP 已配置，运行时核对搜索能力' : '需先连接并检查 MCP，不会自动登录') : '默认推荐，无需搜索密钥；AI 分析仍按文字模型计费'}</small></span></label>)}</fieldset>
      <label className="research-semantic"><input type="checkbox" checked={useSemantic} disabled={disabled || localOnly || !settings.providers?.qwen?.configured} onChange={event => setUseSemantic(event.target.checked)}/><span>本次启用 Qwen 语义检索<small>默认使用本地关键词。启用后，参考摘要与检索问题会发送至阿里云生成向量，可能另计费；需要文字模型页已保存 Qwen 密钥。</small></span></label>
      <div className="research-budget"><span>研究实验预算：{live ? `${money(live.usageCny)} / ${money(live.budgetCny)} 已记录` : '每项目人民币 1 元，已用金额待读取'}</span><span>{sources.includes('web') ? `${searchName}：${money(reservation)} / 次，最多 ${maxRequests} 次，合计预留 ${money(maxRequests * reservation)}` : '本次不调用扩展网页搜索，搜索预留 ¥0'}</span></div>
      <p className="small-note">{useQwenSearch ? `Qwen 联网直接使用你的关键词，省去查询规划调用；分析沿用 ${config?.models.analysis || settings.routes.analysis}。` : `文字规划与分析沿用 ${config?.models.query || settings.routes.classification} / ${config?.models.analysis || settings.routes.analysis}。`}文字模型费用计入原项目美元预算；搜索与可选向量费用以人民币单独记录，预留仅为本地估算，不是服务商实际收费上限。</p></>}
      {xhsMode && <p className="research-budget">本次使用 {settings.models[analysisModel]?.label || analysisModel} 分析，费用计入原项目美元预算。MCP 读取与本地筛选不调用模型；实际模型收费以 DeepSeek 账单为准。</p>}
      {!localOnly && (queryRequired && !queryConfigured || !analysisConfigured) && <div className="research-warning">{xhsMode ? '请先在文字模型设置保存 DeepSeek 密钥。新模式会使用这里选择的 DeepSeek，不会自动改用其他服务商。' : !analysisConfigured ? '请先配置参考分析使用的文字模型（沿用“评论复盘”分工）。' : '当前来源需要查询规划模型，请配置文字模型中的“评论分类”分工。'}<button className="text-button" onClick={() => { settingsTab('models'); go('settings'); }}>前往文字模型设置</button></div>}
      {!xhsMode && remaining === 0 && <p className="research-warning">本项目人民币研究实验预算已用尽。可关闭语义检索，并取消网页搜索后使用 RSS，或仅重新分析已保存参考；文字分析仍按项目美元预算计费。</p>}
      <div className="research-actions"><button className="button primary" disabled={disabled || !canRun || remaining === 0 && (activeSources.includes('web') || activeSemantic)} onClick={() => setConfirming('collect')}><Search size={16}/>{xhsMode ? '查找帖子并分析' : '研究近七天内容'}</button>{reusableCount > 0 && <button className="button" disabled={disabled || !canReuse || activeSemantic && remaining === 0} onClick={() => setConfirming('reuse')}>仅重新分析已保存参考</button>}{!xhsMode && <button className="button" disabled={disabled} onClick={() => { settingsTab('research'); go('settings'); }}>配置联网检索</button>}<button className="text-button" disabled={disabled || connection.loading} onClick={() => void connection.reload()}><RefreshCw size={14}/>刷新连接状态</button><small>{keywordList.length}/{keywordLimit} 个关键词</small></div>
    </section>
    {(current.run || statusError || running) && <section className="panel research-progress" aria-live="polite"><div className="section-heading"><h3>{running ? <Loader2 size={17} className="spin"/> : <Check size={17}/>} {pending && current.run?.status !== 'running' ? '正在提交本次研究' : PHASES[current.run?.phase || 'query'] || '正在整理研究记录'}</h3><button className="text-button" disabled={localOnly || !config?.available} onClick={() => void readStatus()}><RefreshCw size={14}/>刷新进度</button></div><p>{current.run ? `开始 ${date(current.run.startedAt)}${current.run.finishedAt ? ` · 完成 ${date(current.run.finishedAt)}` : ''}` : '请求已提交，等待本机处理。'}</p>{current.run?.error && <p className="research-warning">{current.run.error} 已保存的历史参考不会因失败清空。</p>}{statusError && <p className="research-warning">状态读取未完成：{statusError}</p>}{pollPaused && <p className="small-note">自动刷新已暂缓，可稍后点击“刷新进度”。刷新不会重新发起研究。</p>}</section>}
    <section className="research-results" aria-label="研究分析结果"><div className="section-heading"><div><h2>证据与创作切入点</h2><p className="muted">观察来自原始资料，吸引点属于待验证假设。跨平台不比较绝对互动量，热度也不等于转化。</p></div><span className="muted">已选 {chosen.length}/5</span></div>
      {current.retrieval?.comparison && <div className="panel research-comparison" aria-label="本轮样本口径"><b>{PLATFORM_NAMES[current.retrieval.comparison.platform]} · {current.retrieval.comparison.related} 条同话题候选</b><p>其中 {current.retrieval.comparison.knownMetrics} 条提供{METRIC_NAMES[current.retrieval.comparison.metric] || current.retrieval.comparison.metric}数据，{current.retrieval.comparison.unknownMetrics} 条未提供；{current.retrieval.comparison.unrelated} 条尚未核对主题关联，不进入 AI 分析。</p><p className="small-note">{current.retrieval.comparison.sampleMedian === null ? '有数据的样本不足 5 条，暂不建立热度基线。' : `本轮可见指标中位数 ${current.retrieval.comparison.sampleMedian.toLocaleString('zh-CN')}，仅作样本内参考；不代表行业基准。`} 一次采集不能判断增长速度，AI 会给出待验证的吸引点与可执行测试。</p></div>}
      {current.run && <p className="small-note research-saved-scope">最近研究请求：{current.run.discovery ? `${PLATFORM_NAMES[current.run.discovery.platform || 'xiaohongshu']} · ${TIME_NAMES[current.run.discovery.timeRange]} · ${SORT_NAMES[current.run.discovery.sortBy]} · ${TYPE_NAMES[current.run.discovery.noteType]}` : '近期热点与网页 · 近七天'}{current.run.analysisModel ? ` · ${settings.models[current.run.analysisModel]?.label || current.run.analysisModel}` : ''}。{current.run.status === 'failed' ? '本次请求未完成，旧分析和已选参考保留；帖子列表还可能包含本轮已采集的资料。' : current.run.status === 'running' ? '本次仍在进行，下方保留旧分析，并逐步保存本轮资料。' : '更改上方选项后，需重新开始研究才会更新这里的结果。'}</p>}
      {current.references.some(reference => reference.kind in PLATFORM_NAMES) && <section className="panel research-discovered-posts" aria-label="发现的同话题内容"><div className="section-heading"><div><h3>发现的同话题内容</h3><p className="muted">按本轮采集结果展示。先核对主题相关性，再比较播放或互动；未提供的数字保留未知。</p></div><Pill color="gray">{current.references.filter(reference => reference.kind in PLATFORM_NAMES).length} 条可核对样本</Pill></div><div className="research-post-grid">{current.references.filter(reference => reference.kind in PLATFORM_NAMES).map(reference => <ReferenceCard reference={reference} key={reference.id}/>)}</div></section>}
      {(current.reports.length > 0 || current.queries.length > 0) && <details className="panel research-coverage"><summary>查看本次查询、来源覆盖与检索方式</summary>{current.queries.length > 0 && <div className="research-tags">{current.queries.map(query => <span key={query}>{query}</span>)}</div>}<div className="research-reports">{current.reports.map((report, index) => <div key={`${report.sourceId}:${index}`}><b>{report.name} · {report.status === 'ok' ? `${report.count} 条` : report.status === 'failed' ? '未读取成功' : '已跳过'}</b><p>{report.message}</p></div>)}</div><p className="small-note">检索：{current.retrieval?.method === 'hybrid' || current.retrieval?.method === 'semantic' ? 'Qwen 语义与本地关键词' : current.retrieval?.method === 'sample-interaction' ? '本地关键词与可见互动排序' : current.retrieval?.method === 'recent-candidates' ? '近期候选回退（无关键词命中）' : current.retrieval?.method === 'keyword' ? '本地关键词' : '检索方式未记录'}{current.retrieval ? ` · ${current.retrieval.count} 条参考` : ''}。{current.retrieval?.note ? `${current.retrieval.note} ` : ''}仅覆盖本次来源可读取且符合所选范围的样本；不限时间可以保留历史帖子，日期仍需核实。发布时间与采集时间分别记录，判断增长速度需要至少两次采样。</p></details>}
      {!!current.pendingReferences?.length && <details className="panel research-coverage research-pending"><summary>待核实线索 · {current.pendingReferences.length} 条</summary><p className="small-note">这些链接未满足本次原文、日期或来源核验条件，没有进入分析。联网模型的回答不作为原文证据。</p><ul>{current.pendingReferences.map((reference, index) => { const url = safeURL(reference.url); return <li key={`${reference.url}:${index}`}>{url ? <a href={url} target="_blank" rel="noreferrer">{reference.title || '查看来源链接'} <ExternalLink size={12}/></a> : <b>{reference.title || '来源链接不可用'}</b>}<p>{reference.reason || '原文或发布日期尚未核实'}</p></li>; })}</ul></details>}
      {current.analyses.length ? <div className="research-analysis-grid">{current.analyses.map(analysis => <AnalysisCard key={analysis.id} analysis={analysis} references={current.references} chosen={chosen.includes(analysis.id)} acknowledged={ack.includes(analysis.id)} disabled={disabled || localOnly || !config?.available} full={chosen.length >= 5} onChoose={() => setChosen(toggle(chosen, analysis.id))} onAcknowledge={() => setAck(toggle(ack, analysis.id))}/>)}</div> : <div className="panel"><Empty title={current.run?.status === 'completed' ? '本次没有足够证据形成参考' : '先设置范围，再开始研究'} text="有出处和可核对原文、符合所选范围的内容才进入参考分析；没有适合结果时不会编造热点。"/></div>}
      {current.analyses.length > 0 && <div className="panel research-selection"><p>{riskPending ? '请逐项核对并确认已选参考的名称与素材使用风险。' : '只把你确认的参考和标签带入后续创作，不会替代项目事实。最多选择 5 项，也可清空选择。'}</p><button className="button primary" disabled={disabled || localOnly || !config?.available || !selectionChanged || riskPending} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/research/select`, 'POST', { expectedRevision: current.revision, analysisIds: chosen, acknowledgedIds: ack.filter(id => chosen.includes(id)), confirmed: true }); await readStatus(); notify(chosen.length ? '创作参考已保存，后续生成会带入已选参考' : '已清空本次创作参考选择'); })}><Check size={16}/>确认创作参考</button></div>}
      {current.references.some(reference => !(reference.kind in PLATFORM_NAMES)) && <details className="panel research-coverage"><summary>网页与新闻参考库 · {current.references.filter(reference => !(reference.kind in PLATFORM_NAMES)).length} 条</summary>{current.references.filter(reference => !(reference.kind in PLATFORM_NAMES)).map(reference => <ReferenceCard reference={reference} key={reference.id}/>)}</details>}
    </section>
    <section className="panel research-selected"><div className="section-heading"><div><h2>带着参考，开始创作</h2><p className="muted">已确认的参考自动附带到后续生成；在 AI 文案窗口中选择已安装的写作 Skills。</p></div><button className="button primary" disabled={disabled || !selected.length} onClick={() => go('studio', project.id)}>去创作 <ArrowRight size={15}/></button></div>{selected.length ? <><p className="small-note">采用：{selected.map(item => item.title).join('、')}</p><div className="research-tags">{[...new Set(selected.flatMap(item => item.tags))].map(tag => <span key={tag}><Tag size={13}/>{tag}</span>)}</div></> : <p className="small-note">尚未确认创作参考。先在上方选用切入点，再确认保存。</p>}</section>
    {confirming && <Modal title={confirming === 'reuse' ? '重新分析已保存参考' : xhsMode ? `确认${platformName}同话题研究` : '确认本次联网研究'} description={confirming === 'reuse' ? '复用本机参考，重新核对范围、检索与分析，不重新采集。' : '确认后才会搜索并调用模型，不会自动发布任何内容。'} onClose={() => { if (!disabled) setConfirming(null); }}><div className="research-consent">
      <p><b>范围：</b>{xhsMode ? `${TIME_NAMES[discovery.timeRange]} · ${SORT_NAMES[discovery.sortBy]} · ${TYPE_NAMES[discovery.noteType]}` : '近七天'}；{keywordList.join('、')}；来源 {activeSources.map(source => SOURCE_NAMES[source]).join('、')}。</p>
      {xhsMode && confirming !== 'reuse' && <p><b>读取账号：</b>{selectedAccount?.name || platformConnection?.accountName || '当前平台连接'}。采集任务会固定这个账号，读取记录保留账号归属；账号名称不会发送给分析模型。</p>}
      <p>{xhsMode ? `${confirming === 'reuse' ? `仅复用本机已保存的${platformName}内容，并按所选时间范围与内容形式重新筛选。` : `你的关键词交给已选${platformName} MCP，读取其权限范围内的内容详情。`}本地清洗后的同话题短摘录、已取得的指标与必要项目资料会发送给 ${settings.models[analysisModel]?.label || analysisModel}，生成改进建议与验证方式。参考库保存在本机。` : confirming === 'reuse' ? '本次不进行 AI 扩词和网络采集。已保存参考中的短摘录、公开数据与必要项目资料仍会发送给分析模型，过期来源将重新筛除。' : useQwenSearch ? '你的关键词会直接发送给 Qwen 联网模型，随后按返回链接读取原文；模型回答不作为原文证据。仅将核实正文与发布日期的近七天资料交给分析模型，未核实链接单独保留。清洗与参考库保存在本机。' : '项目关键词与必要项目资料会发送给查询规划模型；查询词会发送给所选来源，获取的短摘录及公开互动数据再交给分析模型。清洗与参考库保存在本机。'}</p>
      {activeSemantic && <p>本次已勾选语义检索：参考摘要和检索问题还会发送给阿里云 Qwen，生成向量索引并用于检索。</p>}
      <p><b>费用：</b>{xhsMode ? '仅调用所选 DeepSeek 分析，计入项目美元预算；不调用 AI 扩词、网页搜索或 Qwen 向量服务。最终费用以 DeepSeek 账单为准。' : <>{confirming === 'reuse' ? '本次不新增网页搜索费用和查询规划费用。' : sources.includes('web') ? `${searchName} 最多 ${maxRequests} 次请求，每次按 ${money(reservation)} 估算，合计预留 ${money(maxRequests * reservation)}；预留不是服务商实际收费上限。` : '本次未选择付费网页搜索。'}{activeSemantic ? '向量请求另按用量记录。' : ''} 搜索与向量共用本项目人民币 1 元实验预算；文字模型另计项目美元预算，最终账单以服务商为准。</>}</p>
      {confirming !== 'reuse' && (xhsMode || activeSources.includes('xiaohongshu')) && <p>{xhsMode ? '每轮最多 3 个关键词，按来源能力有限量读取详情，最多 10 条同话题内容进入分析。' : '小红书最多 2 次搜索、8 条详情。'}可读取范围取决于登录状态与 MCP 能力，不保证完整覆盖所选时段或全站。缺失指标保留为空，高互动只代表本次返回样本中的表现。</p>}
      <div className="modal-actions"><button className="button" disabled={disabled} onClick={() => setConfirming(null)}>取消</button><button className="button primary" disabled={disabled || !(confirming === 'reuse' ? canReuse : canRun) || remaining === 0 && (activeSemantic || confirming !== 'reuse' && activeSources.includes('web'))} onClick={start}>{confirming === 'reuse' ? '确认传输并重新分析' : '确认传输并开始研究'}</button></div>
    </div></Modal>}
  </div>;
}

