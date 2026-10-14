import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { useStudio } from '../context';
import type { CorpusRagStatus, Project } from '../types';
import '../corpus-rag.css';

const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const money = (value: number) => !Number.isFinite(value) ? '待估算' : value > 0 && value < .000001 ? '< ¥0.000001' : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}`;

export function CorpusRag({ project, onStatusChange }: { project: Project; onStatusChange: (status: CorpusRagStatus | null) => void }) {
  const { settings, busy, mutate, notify, run, runBackground } = useStudio();
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  const [status, setStatus] = useState<CorpusRagStatus | null>(null);
  const [loading, setLoading] = useState(!localOnly);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'build' | 'enable' | 'clear' | null>(null);
  const requestId = useRef(0), mounted = useRef(true);
  const path = `/projects/${project.id}/corpus/rag`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++; }; }, []);
  const reload = useCallback(async () => {
    if (localOnly) { setLoading(false); setStatus(null); onStatusChange(null); return; }
    const request = ++requestId.current;
    setLoading(true); setError('');
    try {
      const next = await api<CorpusRagStatus>(path);
      if (!mounted.current || request !== requestId.current) return;
      setStatus(next); onStatusChange(next);
    } catch (error) {
      if (!mounted.current || request !== requestId.current) return;
      setStatus(null); onStatusChange(null); setError(messageOf(error));
    } finally { if (mounted.current && request === requestId.current) setLoading(false); }
  }, [path, localOnly, onStatusChange]);
  useEffect(() => { void reload(); }, [reload, project.revision]);
  const locked = busy || pending || loading;
  const enabledDocuments = (project.corpus || []).filter(document => document.enabled).length;
  const remaining = status ? Math.max(0, status.budgetCny - status.usageCny) : 0;
  const exceedsBudget = !!status && status.plan.estimatedCny > remaining;
  const canBuild = !!status?.available && status.configured && status.connectionSupported !== false && status.plan.chunksCount > 0 && status.plan.chunksCount <= 200 && status.plan.withinLimit !== false && Number.isFinite(status.plan.estimatedCny) && !exceedsBudget && remaining > 0;
  const canEnable = !!status?.available && status.configured && status.connectionSupported !== false && status.ready && remaining > 0;
  async function change(mode: 'build' | 'enable' | 'disable' | 'clear') {
    if (!status || localOnly || locked) return;
    if ((mode === 'build' && !canBuild) || (mode === 'enable' && !canEnable)) return;
    const work = async () => {
    setPending(true); setError('');
    let saved = false;
    try {
      await mutate(path, mode === 'build' ? 'POST' : mode === 'clear' ? 'DELETE' : 'PATCH', mode === 'build' ? { consent: true, expectedFingerprint: status.plan.fingerprint } : mode === 'enable' ? { enabled: true, consent: true } : mode === 'disable' ? { enabled: false } : undefined);
      saved = true;
      if (!mounted.current) return;
      setConfirming(null);
      notify(mode === 'clear' ? '语义索引已清除，介绍文档已保留' : mode === 'disable' ? '语义检索已关闭，继续使用本地关键词检索' : mode === 'enable' ? '语义检索已启用，后续检索问题会发送至阿里云' : '语义索引已建立并启用，请留意后续查询费用');
      await reload();
    } catch (error) {
      if (!mounted.current) return;
      setError(saved ? `变更已保存，但状态刷新未完成，请重新读取状态，不必重复建立。${messageOf(error)}` : messageOf(error));
      throw error;
    } finally { if (mounted.current) setPending(false); }
    };
    if (mode === 'build') await runBackground('建立语义索引', work);
    else await run(work);
  }
  return <section className="panel corpus-rag" aria-label="Qwen 语义检索设置">
    <div className="corpus-rag-heading"><div><h2><BookOpen size={18}/>Qwen 语义检索</h2><p>让不同说法的问题也能找到相关资料，结合本地关键词一起检索。</p></div><span className="corpus-rag-badge">{localOnly ? '本地关键词' : loading ? '读取状态中' : status?.enabled && status.ready ? '已启用' : status?.builtAt && !status.ready ? '索引需更新' : status?.builtAt ? '索引已保存 · 已关闭' : '按需启用'}</span></div>
    {localOnly ? <p className="small-note">此网页版暂用本地关键词检索，不会建立云端向量。语义检索请在 Windows 版的加密本地工作区使用。</p> : <>
      <p className="small-note">索引保存在本机。建立索引时，已启用文档的必要正文会发送至阿里云；开启后，手动查询及策略、下期策划、文案生成所需的检索问题也会发送至阿里云，可能产生费用。</p>
      {loading && <p className="small-note" role="status">正在读取索引状态与本次费用估算…</p>}
      {error && <div className="corpus-rag-error" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={pending || loading} onClick={() => void reload()}><RefreshCw size={14}/>重新读取状态</button><p>状态不明时，手动查询先使用本地关键词。</p></div>}
      {status && <>
        {!status.available ? <p className="small-note">当前工作区未满足加密本地访问条件，继续使用本地关键词检索。请在 Windows 应用的本地用户工作区开启此功能。</p> : <>
          <dl className="corpus-rag-metrics"><div><dt>参与资料</dt><dd>{enabledDocuments} 份 · {status.plan.chunksCount} 段</dd></div><div><dt>本次待建立 / 更新</dt><dd>{status.plan.changedCount} 段 · 预计 {money(status.plan.estimatedCny)}</dd></div><div><dt>本项目本轮实验预算</dt><dd>已记 {money(status.usageCny)} / {money(status.budgetCny)}</dd></div></dl>
          <p className="small-note">使用 {status.model}，512 维。本轮每项目累计预算为人民币 1 元；估算与已记录费用仅供控制用量，实际云计费以阿里云控制台为准。后续查询另计入此预算。</p>
          {status.connectionSupported === false && <p className="corpus-rag-hint">当前 Qwen 密钥选择了非北京地域；此版本语义检索仅支持北京。请使用本地关键词，或在设置中另行保存北京地域密钥。</p>}
          {!status.configured && status.connectionSupported !== false && <p className="corpus-rag-hint">请先配置 Qwen API 密钥。<a href="#settings">前往连接与设置 <ExternalLink size={13}/></a></p>}
          {status.plan.chunksCount === 0 && <p className="corpus-rag-hint">先导入介绍文档并勾选“参与检索”，再建立索引。</p>}
          {status.plan.chunksCount > 200 && <p className="corpus-rag-hint">本轮最多建立 200 段，请先停用暂不需要的文档。</p>}{!!status.plan.invalidChunksCount && <p className="corpus-rag-hint">部分段落过长，请拆分文档后重新导入再建立索引。</p>}{status.builtAt && <p className="small-note">上次建立：{new Date(status.builtAt).toLocaleString('zh-CN')}{!status.ready ? '。资料已变化或索引未就绪，当前回退本地关键词；确认更新后恢复语义检索。' : '。可关闭并保留索引，或清除索引后重新建立。'}</p>}
          {(remaining <= 0 || exceedsBudget) && <p className="corpus-rag-hint">{remaining <= 0 ? '本项目本轮实验预算已用尽，继续使用本地关键词检索。' : '本次估算超过剩余预算，请减少参与检索的文档。'}</p>}
          <div className="corpus-rag-actions">
            {(!status.ready || !status.builtAt) && <button type="button" className="button small" disabled={locked || !canBuild} onClick={() => setConfirming('build')}>{status.builtAt ? '更新语义索引' : '建立语义索引'}</button>}
            {status.ready && !status.enabled && <button type="button" className="button small" disabled={locked || !canEnable} onClick={() => setConfirming('enable')}>启用已有索引</button>}
            {status.enabled && <button type="button" className="button small" disabled={locked} onClick={() => void change('disable')}>关闭语义检索</button>}
            {(status.builtAt || status.enabled || status.ready) && <button type="button" className="text-button" disabled={locked} onClick={() => setConfirming('clear')}><Trash2 size={14}/>清除索引</button>}
          </div>
        </>}
        {confirming && <div className="corpus-rag-confirm" role="group" aria-label={confirming === 'clear' ? '确认清除语义索引' : '确认云端文本处理'}>
          <b>{confirming === 'clear' ? '清除索引并关闭语义检索？' : confirming === 'enable' ? '启用后，检索问题会发送到阿里云' : `建立索引需要发送 ${enabledDocuments} 份已启用文档的正文`}</b>
          <p>{confirming === 'clear' ? '只清除本机语义索引，保留项目介绍文档和已保存的引用。已经发生的云端请求或费用不会撤回。' : confirming === 'enable' ? '本次启用不会重新发送文档；后续查询以及生成前的自动检索会发送所需问题文本，并可能产生费用。你可以随时关闭。' : `正文用于生成向量，索引保存在本机，本次估算 ${money(status.plan.estimatedCny)}。完成后开启语义检索，后续问题文本也会发送至阿里云并可能计费。请确认资料适合发送。`}</p>
          <div className="corpus-rag-actions"><button type="button" className="button small" disabled={locked} onClick={() => setConfirming(null)}>取消</button><button type="button" className={`button small ${confirming === 'clear' ? 'danger' : 'primary'}`} disabled={locked || confirming === 'build' && !canBuild || confirming === 'enable' && !canEnable} onClick={() => void change(confirming)}>{pending ? '处理中…' : confirming === 'clear' ? '确认清除，保留语料' : confirming === 'enable' ? '确认启用，允许云端查询' : '确认发送并建立、启用'}</button></div>
        </div>}
      </>}
    </>}
  </section>;
}
