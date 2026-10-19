import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Check, Download, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api, download, IS_STATIC, IS_WEB } from '../api';
import { Field, Modal, Pill } from '../components';
import { useStudio } from '../context';
import type { Platform } from '../types';
import { ACCOUNT_CREATION_WORKFLOWS, resolveAccountCreation } from '../../server/account-creation.mjs';
import type { SkillWorkflowId } from '../../server/skill-workflows.mjs';
import '../creative-skills.css';

export type InstalledCreativeSkill = {
  id: string; name: string; description: string; version: string;
  platforms: Platform[]; stages: string[]; enabled: boolean; instructions: string;
  sourceText: string; sourceFile: string; installedAt: string; workflowId?: string;
  eligibleWorkflowIds?: string[]; targetWorkflowLabel?: string;
};
type BuiltinSkill = { id: string; name: string; description: string; version: string; instructions: string; customized?: boolean; defaultInstructions?: string; baseVersion?: string; updatedAt?: string };
export type SkillWorkflow = {
  id: string; label: string; description: string; skills: BuiltinSkill[];
  selectedSkillId: string; eligibleSkillIds: string[];
};
export type CreativeSkillsCatalog = {
  revision: number; builtin: BuiltinSkill; skills: InstalledCreativeSkill[]; workflows: SkillWorkflow[]; defaultEditable?: boolean;
};
type SkillPreview = Omit<InstalledCreativeSkill, 'id' | 'enabled' | 'installedAt'> & { warnings: string[] };
type DefaultSkillDraft = {
  workflowId: string; workflowLabel: string; skillId: string; skillName: string;
  instructions: string; originalInstructions: string; defaultInstructions: string;
  version: string; baseVersion: string; customized: boolean; expectedRevision: number;
};
const MAX_FILE_BYTES = 24 * 1024;
const template = `---
name: 我的工作步骤规则
description: 为选定的 AI 工作步骤补充业务要求。
version: 1.0.0
---

# 目标
- 在默认规则之上，补充这个步骤需要的业务要求。

# 处理要求
- 只使用本次提供的资料；缺失事实应说明，不编造价格、数据或体验。
- 优先给出具体、简明且可执行的结果。
- 保留本步骤要求的输出格式、字段与证据来源。

# 表达偏好
- 在这里填写你的品牌语气、分析侧重点或画面要求。
`;
const groups = [
  { label: 'Redfox 小红书助手', ids: ['xhs-creator', 'xhs-title-score', 'xhs-cover', 'xhs-note-analyzer'] },
  { label: '项目与资料', ids: ['brief-import', 'document-context'] },
  { label: '选题与研究', ids: ['research-query', 'web-search', 'research-analysis'] },
  { label: '策略与文案', ids: ['strategy', 'planning', 'copy-xiaohongshu', 'copy-douyin', 'copy-tiktok', 'copy-youtube', 'copy-instagram'] },
  { label: '检查与复盘', ids: ['word-review', 'price-semantic', 'classification', 'analysis'] },
  { label: '图片与视频', ids: ['cover', 'first_frame', 'last_frame', 'video'] },
];
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

/** Selection lives in Settings; this summary never overrides a request. */
export function WorkflowSkillSummary({ workflowId, platform, onManage, disabled = false }: {
  workflowId: string; platform?: Platform; onManage?: () => void; disabled?: boolean;
}) {
  const { state, project, go } = useStudio();
  const [catalog, setCatalog] = useState<CreativeSkillsCatalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setCatalog(null); setError('');
    api<CreativeSkillsCatalog>('/creative-skills').then(result => { if (live) setCatalog(result); })
      .catch(error => { if (live) setError(errorText(error)); });
    return () => { live = false; };
  }, [workflowId, state.skillsRevision]);
  const workflow = catalog?.workflows?.find(item => item.id === workflowId);
  const customizedDefaults = workflow?.skills.filter(skill => skill.customized) || [];
  let selected: { name: string; version: string } | null | undefined = workflow && catalog?.skills.find(skill => skill.id === workflow.selectedSkillId);
  let accountRuleError = '';
  let accountCount = 0;
  try {
    if (project && workflow && ACCOUNT_CREATION_WORKFLOWS.includes(workflowId as SkillWorkflowId)) {
      const resolved = resolveAccountCreation(state, project, platform || workflowId.startsWith('copy-') && workflowId.slice(5) as Platform || undefined, workflowId as SkillWorkflowId);
      selected = resolved.creativeSkill;
      accountCount = resolved.accountContext?.accounts.length || 0;
    }
  } catch (failure) { accountRuleError = errorText(failure); }
  function manage() {
    if (onManage) return onManage();
    try { sessionStorage.setItem('studio-settings-section', 'skills'); } catch { /* navigation still works */ }
    go('settings');
  }
  return <section className="workflow-skill-summary" aria-label="本步骤 Skills">
    <div className="creative-skill-heading"><b><BookOpen size={15}/>本步骤 Skills{workflow ? ' · ' + workflow.label : ''}</b><button type="button" className="text-button" disabled={disabled} onClick={manage}>在设置中管理</button></div>
    {accountRuleError && <p className="error-text" role="alert">{accountRuleError}</p>}
    {accountCount > 0 && <p className="small-note">已按上方创作账号加载身份记忆与方案。{accountCount > 1 ? '各平台分别使用对应账号的规则。' : '本次 Skills 选择包含账号方案设置。'}</p>}
    {error ? <p className="small-note" role="alert">暂时无法读取规则设置：{error}。实际生成使用已保存的本步骤设置。</p> : !catalog ? <p className="small-note" role="status">正在读取规则…</p> : workflow ? <>
      <p className="small-note">{customizedDefaults.length ? <>已启用自定义默认规则：{customizedDefaults.map((skill, index) => <span key={skill.id}>{index > 0 ? '、' : ''}<strong>{skill.name}</strong> · v{skill.version}</span>)}</> : '默认规则已启用'}{selected && !IS_WEB ? <>，叠加 <strong>{selected.name}</strong> · v{selected.version}</> : !selected ? '，未叠加自装 Skills' : ''}。修改后用于之后的新请求，已运行任务保留原规则。</p>
      {IS_WEB && selected && <p className="small-note" role="alert">本地已选择 <strong>{selected.name}</strong> · v{selected.version}。网页版暂只使用默认规则，当前选择会阻止生成；请在设置中切回默认规则，或使用 Windows 版导入并选用。</p>}
    </> : <p className="small-note">此步骤的规则由服务端配置，请在设置中查看。</p>}
  </section>;
}

export function CreativeSkillsSettings() {
  const { mutate, busy, notify, settings } = useStudio();
  const [catalog, setCatalog] = useState<CreativeSkillsCatalog | null>(null);
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [text, setText] = useState(''), [fileName, setFileName] = useState('SKILL.md');
  const [workflowId, setWorkflowId] = useState(''), [preview, setPreview] = useState<SkillPreview | null>(null);
  const [showImport, setShowImport] = useState(false), [deleting, setDeleting] = useState('');
  const [defaultDraft, setDefaultDraft] = useState<DefaultSkillDraft | null>(null);
  const [defaultError, setDefaultError] = useState(''), [defaultStale, setDefaultStale] = useState(false);
  const [restoreDefault, setRestoreDefault] = useState(false), [discardDefault, setDiscardDefault] = useState(false);
  const [filter, setFilter] = useState('全部步骤');
  const importRef = useRef<HTMLSelectElement>(null);
  const prefix = useId(), locked = busy || pending || loading || !catalog;
  const defaultEditable = !IS_WEB && catalog?.defaultEditable !== false && (!settings.team || settings.team.role === 'admin');
  const defaultBytes = new TextEncoder().encode(defaultDraft?.instructions || '').byteLength;
  const defaultDirty = !!defaultDraft && defaultDraft.instructions !== defaultDraft.originalInstructions;
  const target = catalog?.workflows?.find(workflow => workflow.id === workflowId);
  const otherWorkflowIds = (catalog?.workflows || []).filter(workflow => !groups.some(group => group.ids.includes(workflow.id))).map(workflow => workflow.id);
  const workflowGroups = otherWorkflowIds.length ? [...groups, { label: '其他步骤', ids: otherWorkflowIds }] : groups;
  useEffect(() => {
    let live = true;
    api<CreativeSkillsCatalog>('/creative-skills').then(value => { if (live) setCatalog(value); })
      .catch(error => { if (live) setError(errorText(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (defaultDraft && catalog && catalog.revision !== defaultDraft.expectedRevision) setDefaultStale(true);
  }, [catalog?.revision, defaultDraft?.expectedRevision]);
  async function reload() {
    setLoading(true); setError('');
    try { setCatalog(await api<CreativeSkillsCatalog>('/creative-skills')); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }
  function editDefault(workflow: SkillWorkflow, skill: BuiltinSkill) {
    if (locked || !catalog || !defaultEditable) return;
    setDefaultDraft({ workflowId: workflow.id, workflowLabel: workflow.label, skillId: skill.id, skillName: skill.name,
      instructions: skill.instructions, originalInstructions: skill.instructions, defaultInstructions: skill.defaultInstructions ?? skill.instructions,
      version: skill.version, baseVersion: skill.baseVersion ?? skill.version, customized: !!skill.customized, expectedRevision: catalog.revision });
    setDefaultError(''); setDefaultStale(false); setRestoreDefault(false); setDiscardDefault(false);
  }
  function closeDefaultEditor() {
    if (pending) return;
    if (defaultDirty) { setDiscardDefault(true); setRestoreDefault(false); }
    else setDefaultDraft(null);
  }
  async function saveDefault(method: 'PUT' | 'DELETE') {
    const draft = defaultDraft;
    if (!draft || locked || !defaultEditable || defaultStale || !catalog) return;
    if (catalog.revision !== draft.expectedRevision) { setDefaultStale(true); return; }
    if (method === 'PUT' && (!draft.instructions.trim() || defaultBytes > MAX_FILE_BYTES)) {
      setDefaultError('规则正文不能为空，UTF-8 大小不能超过 24 KB。'); return;
    }
    setPending(true); setDefaultError(''); setError(''); setStatus('');
    let saved = false;
    try {
      await mutate('/creative-skills/default', method, { workflowId: draft.workflowId, skillId: draft.skillId, expectedRevision: draft.expectedRevision,
        ...(method === 'PUT' ? { instructions: draft.instructions } : {}) });
      saved = true; setDefaultDraft(null); setRestoreDefault(false); setDiscardDefault(false);
      setCatalog(await api<CreativeSkillsCatalog>('/creative-skills'));
      const success = `${draft.workflowLabel}的「${draft.skillName}」${method === 'DELETE' ? '已恢复出厂规则' : '已保存'}，之后的新请求生效。`;
      setStatus(success); notify(success);
    } catch (failure) {
      const message = errorText(failure);
      if (saved) {
        setCatalog(null); setError('规则已保存，但列表刷新失败：' + message + '。请重新读取列表，不必重复提交。');
        notify('规则已保存，请重新读取列表确认当前版本。', true);
      } else {
        setDefaultError(message); notify(message, true);
        if (/版本|冲突|已更新|revision/i.test(message)) setDefaultStale(true);
        try {
          const latest = await api<CreativeSkillsCatalog>('/creative-skills'); setCatalog(latest);
          if (latest.revision !== draft.expectedRevision) setDefaultStale(true);
        } catch { /* Keep the original draft and its revision until the user can refresh. */ }
      }
    } finally { setPending(false); }
  }
  function startImport(id = '') {
    if (id !== workflowId) setPreview(null);
    setWorkflowId(id); setShowImport(true);
    requestAnimationFrame(() => { importRef.current?.focus(); importRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  }
  async function readFile(file?: File) {
    if (!file) return;
    setPreview(null);
    if (!workflowId) { setError('请先选择要导入到哪个工作步骤。'); return; }
    if (!file.name.toLowerCase().endsWith('.md')) { setError('请导入 UTF-8 编码的 .md 文件。'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('文件过大，请使用 24 KB 以内的 Skills 文件。'); return; }
    setPending(true); setError(''); setStatus(''); setPreview(null);
    try { setText(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); setFileName(file.name); setShowImport(true); }
    catch { setError('无法读取文件，请另存为 UTF-8 编码后重试。已输入的内容会保留。'); }
    finally { setPending(false); }
  }
  async function preparePreview() {
    setPending(true); setError(''); setStatus(''); setPreview(null);
    try {
      if (!workflowId) throw new Error('请先选择要导入到哪个工作步骤。');
      if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error('内容过长，请控制在 24 KB 以内。');
      setPreview(await api<SkillPreview>('/creative-skills/preview', 'POST', { fileName, text, workflowId }));
    } catch (error) { setError(errorText(error)); }
    finally { setPending(false); }
  }
  async function change(path: string, method: string, body: object, success: string, installed = false) {
    if (!catalog) return;
    setPending(true); setError(''); setStatus('');
    let saved = false;
    try {
      await mutate(path, method, { ...body, expectedRevision: catalog.revision }); saved = true;
      setCatalog(await api<CreativeSkillsCatalog>('/creative-skills'));
      if (installed) {
        setPreview(null); setText(''); setFileName('SKILL.md'); setShowImport(false); setFilter('全部步骤');
        requestAnimationFrame(() => document.getElementById(prefix + '-workflow-' + workflowId)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      }
      setDeleting(''); setStatus(success); notify(success);
    } catch (error) {
      const message = saved ? '变更已保存，但列表刷新失败：' + errorText(error) + '。请先重新读取列表，不必重复提交。' : errorText(error);
      setError(message); notify(message, true);
      if (saved) { setCatalog(null); setPreview(null); }
    } finally { setPending(false); }
  }
  function skillTarget(skill: InstalledCreativeSkill) {
    if (skill.targetWorkflowLabel) return skill.targetWorkflowLabel;
    const ids = skill.eligibleWorkflowIds || (skill.workflowId ? [skill.workflowId] : []);
    return catalog?.workflows.filter(item => ids.includes(item.id) || item.eligibleSkillIds?.includes(skill.id)).map(item => item.label).join('、') || '历史文案规则';
  }
  return <section className="panel settings-card creative-skills-settings">
    <div className="section-heading"><div><h2><BookOpen size={20}/>AI Skills</h2><p className="muted">在这里统一设置每个 AI 工作步骤使用的规则。</p></div><Pill color="gray">{settings.browserStorage ? '当前浏览器保存' : settings.profileMode ? '本机加密保存' : '当前工作区保存'}</Pill></div>
    <p className="small-note">展开各步骤的默认规则即可查看或编辑，也可用下拉列表叠加一个自己的 Skills。修改默认规则只影响该步骤的这一份规则，其他步骤保持各自设置；保存用于之后的新请求，已运行任务保留原规则。Skills 不运行脚本，也不会额外发起模型调用。</p>
    {IS_WEB && <p className="info-box">网页版的默认规则只读，编辑请使用 Windows 版或团队版。网页版暂只使用默认规则；自装规则可在本地管理。要在网页版生成，请将对应步骤切回“默认规则”；使用自装规则生成，请在 Windows 版导入并选用。</p>}
    {!IS_WEB && catalog && !defaultEditable && <p className="info-box">默认规则只读。{settings.team ? '请联系团队管理员编辑，保存后的规则会用于团队之后的新请求。' : '当前工作区未开放默认规则编辑。'}</p>}
    {IS_STATIC && <p className="small-note">静态体验版可以保存和管理规则，实际 AI 调用需使用已连接模型服务的完整版。</p>}
    {error && <div className="creative-skill-error" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={pending || loading} onClick={() => void reload()}><RefreshCw size={14}/>重新读取列表</button></div>}
    {status && <p className="creative-skill-status" role="status"><Check size={15}/>{status}</p>}
    {loading && <p className="small-note" role="status">正在读取 AI Skills…</p>}
    {catalog && <>
      <div className="creative-skill-toolbar"><span>工作步骤 · {catalog.workflows?.length || 0} 个</span><div><button type="button" className="button small" disabled={locked || catalog.skills.length >= 30} onClick={() => startImport()}><Plus size={15}/>导入 Skills</button><button type="button" className="text-button" onClick={() => download(new Blob([template], { type: 'text/markdown;charset=utf-8' }), 'SKILL-template.md')}><Download size={15}/>下载模板</button></div></div>
      <div className="creative-workflow-filters" aria-label="筛选工作步骤">{['全部步骤', ...workflowGroups.map(group => group.label)].map(label => <button type="button" key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div>
      {workflowGroups.filter(group => filter === '全部步骤' || filter === group.label).map(group => <section className="creative-workflow-group" key={group.label} aria-label={group.label}>
        <h3>{group.label}</h3><div className="creative-workflow-list">{(catalog.workflows || []).filter(workflow => group.ids.includes(workflow.id)).map(workflow => {
          const options = catalog.skills.filter(skill => skill.enabled && workflow.eligibleSkillIds?.includes(skill.id));
          const selected = options.find(skill => skill.id === workflow.selectedSkillId);
          return <article className="creative-workflow-row" id={prefix + '-workflow-' + workflow.id} key={workflow.id}>
            <div className="creative-workflow-about"><h4>{workflow.label}</h4><p>{workflow.description}</p><details className="creative-workflow-default"><summary>默认规则 · {workflow.skills.length} 份{workflow.skills.some(skill => skill.customized) ? ` · ${workflow.skills.filter(skill => skill.customized).length} 份已自定义` : ''}</summary><div>{workflow.skills.map(skill => <article className="creative-workflow-skill" key={skill.id}><div className="creative-skill-heading"><b>{skill.name}</b><small>v{skill.version}</small>{skill.customized && <Pill color="blue">已自定义</Pill>}</div><p>{skill.description}</p><div className="creative-default-actions"><button type="button" className="button small" aria-label={`编辑 ${workflow.label} · ${skill.name}规则`} disabled={locked || !defaultEditable} onClick={() => editDefault(workflow, skill)}><Pencil size={14}/>编辑规则</button>{skill.updatedAt && <small>更新于 {new Date(skill.updatedAt).toLocaleString('zh-CN')}</small>}</div><div className="creative-skill-details"><pre aria-label={workflow.label + ' · ' + skill.name + '规则原文'}>{skill.instructions}</pre></div></article>)}</div></details></div>
            <div className="creative-workflow-choice"><label htmlFor={prefix + '-select-' + workflow.id}>使用的 Skills</label><select id={prefix + '-select-' + workflow.id} aria-label={workflow.label + '使用的 Skills'} value={workflow.selectedSkillId || ''} disabled={locked} onChange={event => void change('/creative-skills/selection', 'PUT', { workflowId: workflow.id, skillId: event.target.value }, workflow.label + '的 Skills 已保存')}><option value="">默认规则</option>{!!workflow.selectedSkillId && !selected && <option value={workflow.selectedSkillId}>原选择已不可用，请改用默认规则</option>}{options.map(skill => <option key={skill.id} value={skill.id}>默认 + {skill.name} · v{skill.version}</option>)}</select><p className="small-note">{selected ? selected.description : options.length ? '有 ' + options.length + ' 个可选的自装 Skills' : '尚未导入此步骤的自装 Skills'}</p><button type="button" className="text-button" disabled={locked || catalog.skills.length >= 30} onClick={() => startImport(workflow.id)}>为此步骤导入</button></div>
          </article>;
        })}</div>
      </section>)}
    </>}
    {showImport && <div className="creative-skill-import">
      <div className="creative-skill-heading"><h3>导入到指定工作步骤</h3><Pill color="gray">先选步骤，再导入</Pill></div>
      <Field label="1. 选择工作步骤" hint="本次导入只用于所选步骤；同一份文件可分别导入多个步骤。"><select ref={importRef} aria-label="导入 Skills 的工作步骤" required value={workflowId} disabled={locked} onChange={event => { setWorkflowId(event.target.value); setPreview(null); setError(''); setStatus(''); }}><option value="">请选择工作步骤</option>{(catalog?.workflows || []).map(workflow => <option value={workflow.id} key={workflow.id}>{workflow.label}</option>)}</select></Field>
      <div className="creative-skill-heading"><b>2. 导入规则文件或粘贴原文</b><label className={'button small file-button ' + (locked || !workflowId ? 'disabled' : '')}>选择 .md 文件<input type="file" accept=".md,text/markdown" aria-label="导入 AI Skills 文件" disabled={locked || !workflowId} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file); }}/></label></div>
      <Field label="Markdown 原文" hint="名称、说明和版本从文件头读取，工作步骤以你在上方的选择为准。"><textarea rows={8} disabled={locked || !workflowId} value={text} maxLength={MAX_FILE_BYTES} onChange={event => { setText(event.target.value); setFileName('SKILL.md'); setPreview(null); setError(''); setStatus(''); }} placeholder={template}/></Field>
      <p className="small-note">{fileName} · UTF-8 · 最多 24 KB。只导入文本规则，外部文件和脚本不会安装。</p>
      <div className="creative-skill-import-actions"><button type="button" className="button" disabled={locked} onClick={() => setShowImport(false)}>收起，保留输入</button><button type="button" className="button primary" disabled={locked || !workflowId || !text.trim()} onClick={() => void preparePreview()}>{pending ? '处理中…' : '预览安装内容'}</button></div>
      {preview && target && <article className="creative-skill-preview"><div className="creative-skill-heading"><b>{preview.name}</b><span>v{preview.version}</span></div><p>{preview.description}</p><p><strong>将导入到：{target.label}</strong></p>{preview.warnings.length > 0 && <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<details className="creative-skill-details"><summary>核对即将安装的原文</summary><pre>{preview.sourceText}</pre></details><p className="small-note">安装后，请在“{target.label}”的下拉列表中选用。本次安装不会改变已有选择。</p><button type="button" className="button primary" disabled={locked || !catalog || catalog.skills.length >= 30} onClick={() => void change('/creative-skills', 'POST', { fileName, text, workflowId, confirmed: true }, '已导入到' + target.label + '，请在该步骤的下拉列表中选用', true)}><Check size={15}/>确认安装到此步骤</button></article>}
    </div>}
    {catalog && <>
      <div className="creative-skill-toolbar"><span>已导入的 Skills · {catalog.skills.length} / 30 个</span></div>
      {catalog.skills.length === 0 && <p className="creative-skill-empty">各步骤已可使用默认规则。需要定制时，可编辑对应步骤的默认规则，或导入一份 Markdown 文件叠加使用。</p>}
      <div className="creative-skill-list">{catalog.skills.map(skill => <article className={'creative-skill-card ' + (skill.enabled ? '' : 'is-disabled')} key={skill.id}>
        <div className="creative-skill-heading"><div><b>{skill.name}</b><small>v{skill.version}</small></div><label className="creative-skill-toggle"><input type="checkbox" aria-label={(skill.enabled ? '停用 ' : '启用 ') + skill.name} checked={skill.enabled} disabled={locked} onChange={event => void change('/creative-skills/' + encodeURIComponent(skill.id), 'PATCH', { enabled: event.target.checked }, event.target.checked ? 'Skills 已启用，可在对应步骤下拉列表中选用' : 'Skills 已停用，使用它的步骤已恢复默认规则')}/>{skill.enabled ? '已启用' : '已停用'}</label></div>
        <p>{skill.description}</p><p className="small-note">工作步骤：{skillTarget(skill)}</p>
        <div className="creative-skill-card-footer"><details className="creative-skill-details"><summary>查看规则与原文</summary><p className="small-note">来源文件：{skill.sourceFile}</p><pre>{skill.sourceText}</pre></details><button type="button" className="icon-button" aria-label={'删除 Skills ' + skill.name} disabled={locked} onClick={() => setDeleting(skill.id)}><Trash2 size={16}/></button></div>
        {deleting === skill.id && <div className="creative-skill-delete"><p>删除“{skill.name}”？使用它的步骤会恢复默认规则，已生成的内容不会改变。</p><button type="button" className="button small" disabled={locked} onClick={() => setDeleting('')}>保留</button><button type="button" className="button small" disabled={locked} onClick={() => void change('/creative-skills/' + encodeURIComponent(skill.id), 'DELETE', {}, 'Skills 已删除，使用它的步骤已恢复默认规则')}>确认删除</button></div>}
      </article>)}</div>
    </>}
    {defaultDraft && <Modal wide title={`编辑默认规则 · ${defaultDraft.workflowLabel}`} description={`当前规则：${defaultDraft.skillName}。只修改这个工作步骤，保存后用于新请求。`} onClose={closeDefaultEditor}>
      <div className="creative-default-editor">
        <div className="creative-skill-heading"><span>当前版本 v{defaultDraft.version}</span><Pill color={defaultDraft.customized ? 'blue' : 'gray'}>{defaultDraft.customized ? '已自定义' : '出厂规则'}</Pill></div>
        <p className="small-note">这是当前生效规则的正文。保留本步骤需要的输出格式、字段和证据要求；相同基础规则在其他工作步骤中可分别编辑。</p>
        {!defaultEditable && <p className="info-box">当前无编辑权限，草稿保留供查看和下载。请在 Windows 版或团队管理员账号中编辑。</p>}
        {defaultError && <p className="creative-skill-error" role="alert">{defaultError}</p>}
        {defaultStale && <div className="creative-default-conflict" role="alert"><b>规则列表已更新，本次草稿尚未保存。</b><p>草稿仍基于打开时的旧版本，不能直接覆盖最新规则。请先下载或复制草稿，关闭后重新打开这份规则，核对最新内容再编辑。</p></div>}
        {(defaultError || defaultStale) && <div className="creative-default-actions"><button type="button" className="button small" disabled={pending || loading} onClick={() => void reload()}><RefreshCw size={14}/>重新读取列表版本</button><span className="small-note">重新读取不会替换草稿，也不会把旧草稿自动改为新版本。</span></div>}
        <Field label="默认规则正文" hint={`UTF-8 已用 ${defaultBytes.toLocaleString('zh-CN')} / ${MAX_FILE_BYTES.toLocaleString('zh-CN')} 字节，最多 24 KB。`}><textarea aria-label="默认规则正文" rows={16} value={defaultDraft.instructions} maxLength={MAX_FILE_BYTES} disabled={pending || restoreDefault || !defaultEditable} onChange={event => { setDefaultDraft({ ...defaultDraft, instructions: event.target.value }); setDefaultError(''); setDiscardDefault(false); }}/></Field>
        {defaultBytes > MAX_FILE_BYTES && <p className="error-text" role="alert">正文超过 24 KB，请缩短后再保存。</p>}
        <details className="creative-skill-details"><summary>查看出厂规则 · v{defaultDraft.baseVersion}</summary><pre aria-label="出厂规则原文">{defaultDraft.defaultInstructions}</pre></details>
        <div className="creative-default-actions"><button type="button" className="text-button" disabled={pending} onClick={() => download(new Blob([defaultDraft.instructions], { type: 'text/markdown;charset=utf-8' }), `${defaultDraft.workflowLabel}-${defaultDraft.skillName}-草稿.md`)}><Download size={14}/>下载当前草稿</button><button type="button" className="text-button" disabled={locked || !defaultEditable || !defaultDraft.customized || defaultStale} onClick={() => { setRestoreDefault(true); setDiscardDefault(false); }}><RotateCcw size={14}/>恢复本步骤的出厂规则</button></div>
        {restoreDefault && <div className="creative-default-restore"><b>确认将「{defaultDraft.workflowLabel} · {defaultDraft.skillName}」恢复为以下出厂规则？</b><p>本步骤的自定义内容及未保存草稿将不再采用；其他步骤、已生成内容和已运行任务保留原状。</p><pre aria-label="即将恢复的出厂规则">{defaultDraft.defaultInstructions}</pre><div className="creative-default-actions"><button type="button" className="button small" disabled={pending} onClick={() => setRestoreDefault(false)}>取消恢复</button><button type="button" className="button small" disabled={locked || !defaultEditable || defaultStale} onClick={() => void saveDefault('DELETE')}>确认恢复出厂</button></div></div>}
        {discardDefault && <div className="creative-default-conflict"><p>本次修改尚未保存。关闭会放弃这份草稿，已保存规则保持不变。</p><div className="creative-default-actions"><button type="button" className="button small" disabled={pending} onClick={() => setDiscardDefault(false)}>继续编辑</button><button type="button" className="button small" disabled={pending} onClick={() => setDefaultDraft(null)}>放弃草稿并关闭</button></div></div>}
        <div className="modal-actions"><button type="button" className="button" disabled={pending} onClick={closeDefaultEditor}>取消</button><button type="button" className="button primary" disabled={locked || !defaultEditable || defaultStale || restoreDefault || !defaultDirty || !defaultDraft.instructions.trim() || defaultBytes > MAX_FILE_BYTES} onClick={() => void saveDefault('PUT')}><Save size={15}/>{pending ? '正在保存…' : '保存本步骤规则'}</button></div>
      </div>
    </Modal>}
  </section>;
}
