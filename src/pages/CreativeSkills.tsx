import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Check, Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, download } from '../api';
import { Field, Pill, platformName } from '../components';
import { useStudio } from '../context';
import type { Platform } from '../types';
import '../creative-skills.css';

export type InstalledCreativeSkill = {
  id: string; name: string; description: string; version: string;
  platforms: Platform[]; stages: 'copy'[]; enabled: boolean; instructions: string;
  sourceText: string; sourceFile: string; installedAt: string;
};
export type CreativeSkillsCatalog = {
  revision: number;
  builtin: { id: 'builtin'; name: string; description: string; version: string; instructions: string };
  skills: InstalledCreativeSkill[];
  workflows?: {
    id: string; label: string; description: string;
    skills: { id: string; name: string; description: string; version: string; instructions: string }[];
  }[];
};
type SkillPreview = Omit<InstalledCreativeSkill, 'id' | 'enabled' | 'installedAt'> & { warnings: string[] };
const MAX_FILE_BYTES = 24 * 1024;
const template = `---
name: 清晰亲切的产品介绍
description: 面向第一次了解产品的用户，用具体场景解释价值。
version: 1.0.0
platforms: [xiaohongshu, douyin]
stages: [copy]
---

# 写作风格
- 先描述一个目标用户熟悉的场景，再说明产品如何帮助他。
- 使用简短自然的句子，每段只讲一个重点。
- 所有功能、价格和体验事实都以本次项目资料为准。
- 结尾提出一个容易回答的问题，不虚构用户评价。
`;
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export function skillMatches(skill: InstalledCreativeSkill, platform?: Platform) {
  return !!platform && skill.enabled && skill.stages.includes('copy') && skill.platforms.includes(platform);
}

export async function validateCreativeSkillSelection(id: string, platform?: Platform) {
  if (!id) return;
  const catalog = await api<CreativeSkillsCatalog>('/creative-skills');
  if (!catalog.skills.some(skill => skill.id === id && skillMatches(skill, platform))) {
    throw new Error('所选创作 Skills 已停用、删除或不适用于当前平台，请重新选择。你的修改要求已保留。');
  }
}

export function CreativeSkillSelector({ platform, value, onChange, onValidityChange, onManage, disabled, builtinOnly = false }: {
  platform?: Platform; value: string; onChange: (id: string) => void;
  onValidityChange: (valid: boolean) => void; onManage: () => void; disabled: boolean; builtinOnly?: boolean;
}) {
  const [catalog, setCatalog] = useState<CreativeSkillsCatalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const selectId = useId();
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    api<CreativeSkillsCatalog>('/creative-skills').then(result => { if (live) setCatalog(result); })
      .catch(error => { if (live) { setCatalog(null); setError(errorText(error)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reloadKey]);
  const options = builtinOnly ? [] : catalog?.skills.filter(skill => skillMatches(skill, platform)) || [];
  const selected = !builtinOnly && value ? options.find(skill => skill.id === value) : catalog?.builtin;
  const unavailable = !builtinOnly && !!value && !selected;
  useEffect(() => { onValidityChange(!loading && !unavailable); }, [loading, unavailable, onValidityChange]);
  return <section className="creative-skill-selector" aria-label="本次创作 Skills">
    <div className="creative-skill-heading"><label htmlFor={selectId}><BookOpen size={16}/>本次写作规则 · Skills</label><button type="button" className="text-button" disabled={disabled} onClick={onManage}>管理 Skills</button></div>
    <select id={selectId} value={builtinOnly ? '' : value} disabled={disabled || loading || builtinOnly} onChange={event => onChange(event.target.value)}>
      <option value="">{catalog?.builtin.name || '平台内置写作规则'}（默认）</option>
      {unavailable && <option value={value}>原选择已不可用，请重新选择</option>}
      {options.map(skill => <option key={skill.id} value={skill.id}>{skill.name} · v{skill.version}</option>)}
    </select>
    <p className="small-note">{builtinOnly ? '自装 Skills 目前可在 Windows 版生成时使用，网页版先用内置规则。' : '内置规则始终生效。选择已安装的 Skills，可叠加本次文案的风格和表达要求。'}</p>
    {loading && <p className="small-note" role="status">正在读取可用 Skills…</p>}
    {error && <div className="creative-skill-error" role="alert"><p>暂时无法读取已安装的 Skills：{error}。你仍可使用内置规则。</p><button type="button" className="text-button" disabled={disabled} onClick={() => setReloadKey(key => key + 1)}>重新读取</button></div>}
    {unavailable && !loading && <p className="creative-skill-error" role="alert">此 Skills 已停用、删除或不适用于当前平台。请重新选择后再生成。</p>}
    {selected && <details className="creative-skill-details"><summary>查看 {selected.name} · v{selected.version}</summary><p>{selected.description}</p><pre>{selected.instructions}</pre></details>}
    {!builtinOnly && !loading && !error && options.length === 0 && <p className="small-note">还没有适用于{platform ? platformName(platform) : '当前内容'}的已启用 Skills，可在设置中安装。</p>}
  </section>;
}

export function CreativeSkillsSettings() {
  const { mutate, busy, notify, settings } = useStudio();
  const [catalog, setCatalog] = useState<CreativeSkillsCatalog | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('SKILL.md');
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [deleting, setDeleting] = useState('');
  const importRef = useRef<HTMLTextAreaElement>(null);
  const locked = busy || pending || loading;
  useEffect(() => {
    let live = true;
    api<CreativeSkillsCatalog>('/creative-skills').then(value => { if (live) setCatalog(value); })
      .catch(error => { if (live) setError(errorText(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  async function reload() {
    setLoading(true); setError('');
    try { setCatalog(await api<CreativeSkillsCatalog>('/creative-skills')); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) { setError('请导入 UTF-8 编码的 .md 文件。'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('文件过大，请使用 24 KB 以内的 Skills 文件。'); return; }
    setPending(true); setError(''); setStatus('');
    try {
      const next = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setText(next); setFileName(file.name); setPreview(null); setShowImport(true);
    } catch { setError('无法读取文件，请另存为 UTF-8 编码后重试。已输入的内容会保留。'); }
    finally { setPending(false); }
  }
  async function preparePreview() {
    setPending(true); setError(''); setStatus('');
    try {
      if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error('内容过长，请控制在 24 KB 以内。');
      setPreview(await api<SkillPreview>('/creative-skills/preview', 'POST', { fileName, text }));
    } catch (error) { setError(errorText(error)); }
    finally { setPending(false); }
  }
  async function change(path: string, method: string, body: object, success: string, installed = false) {
    if (!catalog) return;
    setPending(true); setError(''); setStatus('');
    let saved = false;
    try {
      await mutate(path, method, { ...body, expectedRevision: catalog.revision }); saved = true;
      const next = await api<CreativeSkillsCatalog>('/creative-skills'); setCatalog(next);
      if (installed) { setPreview(null); setText(''); setFileName('SKILL.md'); setShowImport(false); }
      setDeleting(''); setStatus(success); notify(success);
    } catch (error) {
      setError(saved ? `变更已保存，但列表刷新失败：${errorText(error)}。请先重新读取列表，不必重复提交。` : errorText(error));
      if (saved) { setCatalog(null); setPreview(null); }
    } finally { setPending(false); }
  }
  return <section className="panel settings-card creative-skills-settings">
    <div className="section-heading"><div><h2><BookOpen size={20}/>创作与分析 Skills</h2><p className="muted">各环节按需使用内置规则，文案生成还可叠加自己的写作风格。</p></div><Pill color="gray">本地保存</Pill></div>
    <p className="small-note">Skills 是写作与分析规则，不会运行脚本或安装依赖。自装规则目前只用于文案生成。{settings.browserStorage ? '网页版可在本地保存自装 Skills；生成先使用内置规则。自装规则可在 Windows 版导入并使用。' : '生成时，本次规则会与必要项目资料一起发送给所选模型。'}</p>
    {error && <div className="creative-skill-error" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={pending || loading} onClick={() => void reload()}><RefreshCw size={14}/>重新读取列表</button></div>}
    {status && <p className="creative-skill-status" role="status"><Check size={15}/>{status}</p>}
    {loading && <p className="small-note" role="status">正在读取创作 Skills…</p>}
    {catalog && <>
      {!!catalog.workflows?.length && <details className="creative-workflows">
        <summary><span>各环节自动写作与分析规则</span><span className="creative-workflow-count">{catalog.workflows.length} 个场景</span></summary>
        <p className="small-note">一次只加载当前环节所需的规则，不会因为启用 Skills 额外发起模型调用。展开某一环节可查看规则版本与原文。</p>
        <div className="creative-workflow-list">{catalog.workflows.map(workflow => <details className="creative-workflow" key={workflow.id}>
          <summary><span className="creative-workflow-label">{workflow.label}</span><span className="creative-workflow-description">{workflow.description}</span></summary>
          <div className="creative-workflow-content">{workflow.skills.map(skill => <article className="creative-workflow-skill" key={skill.id}>
            <div className="creative-skill-heading"><b>{skill.name}</b><small>v{skill.version}</small></div>
            <p>{skill.description}</p><div className="creative-skill-details"><pre aria-label={`${workflow.label} · ${skill.name}规则原文`}>{skill.instructions}</pre></div>
          </article>)}</div>
        </details>)}</div>
      </details>}
      <article className="creative-skill-card creative-skill-builtin"><div className="creative-skill-heading"><div><b>{catalog.builtin.name}</b><small>v{catalog.builtin.version}</small></div><Pill>文案内置 · 默认启用</Pill></div><p>{catalog.builtin.description}</p><details className="creative-skill-details"><summary>查看基础规则</summary><pre>{catalog.builtin.instructions}</pre></details></article>
      <div className="creative-skill-toolbar"><span>我的文案 Skills · {catalog.skills.length} / 30 个</span><div><button type="button" className="button small" disabled={locked || catalog.skills.length >= 30} onClick={() => { setShowImport(true); requestAnimationFrame(() => importRef.current?.focus()); }}><Plus size={15}/>安装 Skills</button><button type="button" className="text-button" onClick={() => download(new Blob([template], { type: 'text/markdown;charset=utf-8' }), 'SKILL-template.md')}><Download size={15}/>下载模板</button></div></div>
      {catalog.skills.length === 0 && <p className="creative-skill-empty">还未安装。先使用内置规则，也可以导入自己的 Markdown 写作规则。</p>}
      <div className="creative-skill-list">{catalog.skills.map(skill => <article className={`creative-skill-card ${skill.enabled ? '' : 'is-disabled'}`} key={skill.id}>
        <div className="creative-skill-heading"><div><b>{skill.name}</b><small>v{skill.version}</small></div><label className="creative-skill-toggle"><input type="checkbox" checked={skill.enabled} disabled={locked} onChange={event => void change(`/creative-skills/${encodeURIComponent(skill.id)}`, 'PATCH', { enabled: event.target.checked }, event.target.checked ? (settings.browserStorage ? 'Skills 已在本地启用；网页版生成使用内置规则' : 'Skills 已启用，可在 AI 文案中选择') : 'Skills 已停用')}/>{skill.enabled ? '已启用' : '已停用'}</label></div>
        <p>{skill.description}</p><p className="small-note">{skill.platforms.map(platformName).join(' / ')} · 文案生成</p>
        <div className="creative-skill-card-footer"><details className="creative-skill-details"><summary>查看规则与原文</summary><p className="small-note">来源文件：{skill.sourceFile}</p><pre>{skill.sourceText}</pre></details><button type="button" className="icon-button" aria-label={`删除 Skills ${skill.name}`} disabled={locked} onClick={() => setDeleting(skill.id)}><Trash2 size={16}/></button></div>
        {deleting === skill.id && <div className="creative-skill-delete"><p>删除“{skill.name}”？已生成的文案不会改变。</p><button type="button" className="button small" disabled={locked} onClick={() => setDeleting('')}>保留</button><button type="button" className="button small" disabled={locked} onClick={() => void change(`/creative-skills/${encodeURIComponent(skill.id)}`, 'DELETE', {}, 'Skills 已删除')}>确认删除</button></div>}
      </article>)}</div>
    </>}
    {showImport && <div className="creative-skill-import">
      <div className="creative-skill-heading"><h3>导入写作规则</h3><label className={`button small file-button ${locked ? 'disabled' : ''}`}>选择 .md 文件<input type="file" accept=".md,text/markdown" aria-label="导入创作 Skills 文件" disabled={locked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file); }}/></label></div>
      <Field label="Markdown 原文" hint="名称、说明、版本、适用平台与步骤从文件头读取；可先下载模板填写。"><textarea ref={importRef} rows={8} disabled={locked} value={text} maxLength={MAX_FILE_BYTES} onChange={event => { setText(event.target.value); setFileName('SKILL.md'); setPreview(null); setError(''); setStatus(''); }} placeholder={template}/></Field>
      <p className="small-note">{fileName} · UTF-8 · 最多 24 KB。只导入文本规则，外部文件和脚本不会安装。</p>
      <div className="creative-skill-import-actions"><button type="button" className="button" disabled={locked} onClick={() => setShowImport(false)}>收起，保留输入</button><button type="button" className="button primary" disabled={locked || !text.trim()} onClick={() => void preparePreview()}>{pending ? '处理中…' : '预览安装内容'}</button></div>
      {preview && <article className="creative-skill-preview"><div className="creative-skill-heading"><b>{preview.name}</b><span>v{preview.version}</span></div><p>{preview.description}</p><p className="small-note">适用：{preview.platforms.map(platformName).join(' / ')} · 文案生成</p>{preview.warnings.length > 0 && <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<details className="creative-skill-details" open><summary>核对即将安装的原文</summary><pre>{preview.sourceText}</pre></details><p className="small-note">{settings.browserStorage ? '安装后保存在此浏览器。要用于生成，请在 Windows 版导入并选择。' : '安装并启用后，在内容制作 → AI 文案 → 本次写作规则中选择。'}</p><button type="button" className="button primary" disabled={locked || !catalog || catalog.skills.length >= 30} onClick={() => void change('/creative-skills', 'POST', { fileName, text, confirmed: true }, settings.browserStorage ? 'Skills 已保存至本地；网页版生成使用内置规则' : 'Skills 已安装并启用，请在 AI 文案弹窗中选择使用', true)}><Check size={15}/>确认安装并启用</button></article>}
    </div>}
  </section>;
}
