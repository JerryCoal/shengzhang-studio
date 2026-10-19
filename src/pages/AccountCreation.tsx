import { useId, useRef, useState } from 'react';
import { BookOpen, Download, Plus, Save, Upload } from 'lucide-react';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import { download, IS_WEB } from '../api';
import { PLATFORM_NAMES } from '../../server/platform-catalog.mjs';
import { SKILL_WORKFLOWS } from '../../server/skill-workflows.mjs';
import { creativeSkillWorkflowIds } from '../../server/creative-skills.mjs';
import { ACCOUNT_CREATION_WORKFLOWS, creationProfileOf, resolveAccountCreation } from '../../server/account-creation.mjs';
import type { AccountCreationContext } from '../../server/account-creation.mjs';
import type { Account, Platform } from '../types';
import '../account-creation.css';

const identityTemplate = `# 账号身份与长期记忆

## 账号定位
填写账号名称、内容领域和长期目标。

## 目标读者
填写读者的需求、使用场景和知识水平。

## 表达风格
填写语气、常用结构，以及希望避免的表达。

## 固定内容栏目
填写经常分享的主题、图文和视频形式。

## 已确认的身份事实
只填写真实、已确认的背景。未提供的经历、资历和体验不要编造。

## 视觉偏好
填写人物、场景、颜色和画面氛围的偏好。
`;
const newPreset = () => ({ id: crypto.randomUUID(), name: '新创作方案', topic: '', instruction: '', skillSelections: {} as Record<string, string> });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export function AccountIdentityButton({ account, disabled = false }: { account: Account; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="button small" disabled={disabled} onClick={() => setOpen(true)}><BookOpen size={15}/>{account.creationProfile?.identityMarkdown?.trim() ? '身份记忆与创作方案' : '设置账号身份记忆'}</button>{open && <AccountCreationDialog key={account.id} accountId={account.id} onClose={() => setOpen(false)}/>}</>;
}

export function MCPAccountIdentity({ platform, mcpAccountId, disabled = false }: { platform: Platform; mcpAccountId: string; disabled?: boolean }) {
  const { state } = useStudio();
  const account = state.accounts.find(item => item.platform === platform && item.mcpAccountId === mcpAccountId);
  return account ? <div className="account-memory-entry"><AccountIdentityButton account={account} disabled={disabled}/><p className="small-note">此账号的身份记忆随每次 AI 创作带入，可为日常养号、图文或视频分别保存方案。</p></div> : null;
}

export function AccountCreationDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { state, mutate, busy, notify } = useStudio();
  const account = state.accounts.find(item => item.id === accountId);
  const [draft, setDraft] = useState(() => {
    const profile = structuredClone(creationProfileOf(account!));
    if (!profile.presets.length) { const preset = { ...newPreset(), name: '日常创作' }; profile.presets = [preset]; profile.defaultPresetId = preset.id; }
    return profile;
  });
  const [selectedId, setSelectedId] = useState(draft.defaultPresetId || draft.presets[0]?.id || '');
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), fileToken = useRef(0), prefix = useId();
  const selected = draft.presets.find(item => item.id === selectedId) || draft.presets[0];
  const locked = busy || pending;
  if (!account) return <Modal title="账号已变化" onClose={onClose}><p>无法找到此账号，请关闭后重新选择。</p></Modal>;
  const updatePreset = (patch: Partial<typeof selected>) => setDraft(previous => ({ ...previous, presets: previous.presets.map(item => item.id === selected.id ? { ...item, ...patch } : item) }));
  const workflows = SKILL_WORKFLOWS.filter(item => ACCOUNT_CREATION_WORKFLOWS.includes(item.id) && (!item.platform || item.platform === account.platform) && (!item.id.startsWith('xhs-') || account.platform === 'xiaohongshu'));
  async function importIdentity(files: FileList | File[]) {
    if (locked) return;
    const token = ++fileToken.current;
    setError('');
    if (files.length !== 1) { setError('请选择一个账号身份文件；支持 .md 或 .txt。'); return; }
    const file = files[0];
    if (!/\.(md|txt)$/i.test(file.name)) { setError('身份记忆支持 Markdown（.md）或纯文本（.txt）文件。'); return; }
    if (file.size > 24 * 1024 || !file.size) { setError('身份文件不能为空，且不能超过 24 KB。'); return; }
    setPending(true);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (!text.trim() || text.includes('\0')) throw new Error('请使用内容非空的 UTF-8 文本文件。');
      if (token === fileToken.current) setDraft(previous => ({ ...previous, identityMarkdown: text, identityFileName: file.name }));
    } catch (failure) { if (token === fileToken.current) setError(errorMessage(failure)); }
    finally { if (token === fileToken.current) setPending(false); }
  }
  async function save() {
    if (locked) return;
    setError(''); setPending(true);
    try {
      if (new TextEncoder().encode(draft.identityMarkdown).length > 24 * 1024) throw new Error('身份记忆超过 24 KB，请精简后保存。');
      await mutate(`/accounts/${accountId}/creation-profile`, 'PUT', { expectedRevision: draft.revision, identityMarkdown: draft.identityMarkdown, identityFileName: draft.identityFileName, presets: draft.presets, defaultPresetId: draft.defaultPresetId });
      notify('账号身份与创作方案已保存，之后每次 AI 创作都会带入该账号的记忆'); onClose();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  return <Modal title={`${account.name} · 身份记忆与创作方案`} description={`${PLATFORM_NAMES[account.platform]} · 身份记忆长期保存，方案可按内容类型切换。`} onClose={() => { if (!locked) onClose(); }} wide>
    <div className="account-profile-layout"><section>
      <h3>账号身份记忆</h3><p className="small-note">描述“这个账号是谁、为谁创作、怎样表达”。选择这个账号后，每次 AI 文案、配图和视频生成都会带入已保存内容。</p>
      <div className={`identity-file-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void importIdentity(event.dataTransfer.files); }}>
        <input ref={fileInput} type="file" accept=".md,.txt,text/markdown,text/plain" disabled={locked} hidden onChange={event => { if (event.target.files?.length) void importIdentity(event.target.files); event.target.value = ''; }}/>
        <button type="button" className="button small" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={15}/>选择身份 MD / TXT 文件</button><span>或拖拽到这里 · 最多 24 KB</span>
      </div>
      <Field label="身份记忆正文" hint={draft.identityFileName ? `已导入：${draft.identityFileName}。保存后保留在当前工作区，原文件移动不会影响记忆。` : '可直接填写，也可导入自己的 SKILL.md。这里只保存文字创作要求。'}><textarea rows={15} disabled={locked} value={draft.identityMarkdown} onChange={event => setDraft(previous => ({ ...previous, identityMarkdown: event.target.value }))} placeholder="例如：账号专注通勤生活，面向刚工作的年轻人；语气平实、像朋友交流。常写实用清单，避免夸张承诺……"/></Field>
      <div className="row gap-10"><button type="button" className="text-button" disabled={locked} onClick={() => download(new Blob([identityTemplate], { type: 'text/markdown;charset=utf-8' }), '账号身份模板.md')}><Download size={14}/>下载填写模板</button><span className="small-note">{new TextEncoder().encode(draft.identityMarkdown).length.toLocaleString()} / 24,576 字节</span></div>
      {draft.identityMarkdown.trim() && <button type="button" className="text-button" disabled={locked} onClick={() => download(new Blob([draft.identityMarkdown], { type: 'text/markdown;charset=utf-8' }), `${account.name.replace(/[<>:"/\\|?*]/g, '-')}-身份记忆.md`)}>导出当前身份记忆</button>}
    </section><section>
      <h3>这个账号的创作方案</h3><p className="small-note">身份记忆始终保留；这里配置日常养号、干货、产品介绍等不同方案。</p>
      <div className="creation-presets"><select aria-label="编辑创作方案" value={selected.id} disabled={locked} onChange={event => setSelectedId(event.target.value)}>{draft.presets.map(item => <option key={item.id} value={item.id}>{item.name || '未命名方案'}{item.id === draft.defaultPresetId ? ' · 默认' : ''}</option>)}</select><button type="button" className="button small" disabled={locked || draft.presets.length >= 12} onClick={() => { const item = newPreset(); setDraft(previous => ({ ...previous, presets: [...previous.presets, item] })); setSelectedId(item.id); }}><Plus size={14}/>新增</button><button type="button" className="button small" disabled={locked || draft.presets.length >= 12} onClick={() => { const item = { ...structuredClone(selected), id: crypto.randomUUID(), name: `${selected.name.slice(0, 30)} 副本` }; setDraft(previous => ({ ...previous, presets: [...previous.presets, item] })); setSelectedId(item.id); }}>复制</button></div>
      <Field label="方案名称"><input maxLength={80} disabled={locked} value={selected.name} onChange={event => updatePreset({ name: event.target.value })}/></Field>
      <Field label="长期内容方向" hint="例如：通勤日常、居家好物、新手教学；本次具体主题在创作时填写。"><input maxLength={500} disabled={locked} value={selected.topic} onChange={event => updatePreset({ topic: event.target.value })}/></Field>
      <Field label="这套方案的创作要求"><textarea rows={4} maxLength={4000} disabled={locked} value={selected.instruction} onChange={event => updatePreset({ instruction: event.target.value })} placeholder="例如：先提出一个生活问题，再给出三个实用建议；视频画面自然明亮，减少密集字幕。"/></Field>
      <label className="checkbox-row"><input type="checkbox" disabled={locked} checked={selected.id === draft.defaultPresetId} onChange={() => setDraft(previous => ({ ...previous, defaultPresetId: selected.id }))}/>设为选择这个账号时的默认方案</label>
      <details className="account-step-skills"><summary>为各创作步骤选择 Skills</summary><p className="small-note">每步可继承工作区设置、只用内置规则，或选择已经安装的 Skill。身份记忆会持续带入。</p>{workflows.map(workflow => {
        const available = (state.installedSkills || []).filter(skill => skill.enabled && creativeSkillWorkflowIds(skill).includes(workflow.id));
        const saved = selected.skillSelections[workflow.id];
        return <Field key={workflow.id} label={workflow.label}><select id={`${prefix}-${workflow.id}`} disabled={locked} value={saved === undefined ? '__inherit' : saved} onChange={event => { const next = { ...selected.skillSelections }; if (event.target.value === '__inherit') delete next[workflow.id]; else next[workflow.id] = event.target.value; updatePreset({ skillSelections: next }); }}><option value="__inherit">继承工作区设置</option><option value="">仅使用内置规则</option>{saved && !available.some(skill => skill.id === saved) && <option value={saved}>原 Skill 已停用或删除，请重新选择</option>}{available.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></Field>;
      })}<p className="small-note">更多 Skills 可在“连接与设置 → AI Skills”中导入。请先保存此处修改。</p></details>
      {draft.presets.length > 1 && <button type="button" className="text-button muted" disabled={locked} onClick={() => { const remaining = draft.presets.filter(item => item.id !== selected.id); setDraft(previous => ({ ...previous, presets: remaining, defaultPresetId: previous.defaultPresetId === selected.id ? remaining[0].id : previous.defaultPresetId })); setSelectedId(remaining[0].id); }}>移除此方案（保存后生效）</button>}
    </section></div>
    {IS_WEB && <p className="info-box">身份和 Skills 保存在当前浏览器的加密工作区。网页中转暂不发送私人身份与自装规则；使用这些方案进行 AI 生成请在 Windows 版操作。</p>}
    {error && <p className="info-box error-box" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button" disabled={locked} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={locked || draft.presets.some(item => !item.name.trim())} onClick={() => void save()}><Save size={16}/>{pending ? '正在保存…' : '保存身份与方案'}</button></div>
  </Modal>;
}

export function CreationAccountPicker({ platform, disabled = false }: { platform?: Platform; disabled?: boolean }) {
  const { state, project, mutate, busy, run } = useStudio();
  const [editing, setEditing] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false);
  if (!project) return null;
  const channels = platform ? [platform] : project.brief.channels;
  const locked = busy || disabled || pending;
  async function select(channel: Platform, accountId: string, presetId?: string) {
    if (locked || !project) return;
    setError(''); setPending(true);
    try {
      await run(async () => {
        try { await mutate(`/projects/${project.id}/creation-selection`, 'PUT', { platform: channel, accountId, ...(presetId === undefined ? {} : { presetId }), expectedRevision: project.revision }); }
        catch (failure) { setError(errorMessage(failure)); }
      });
    } finally { setPending(false); }
  }
  return <section className="creation-account-picker" aria-label="本次创作账号与身份记忆"><div className="row between"><b><BookOpen size={16}/> 创作账号与身份记忆</b><span className="small-note">每次 AI 生成自动带入</span></div>
    {channels.map(channel => {
      const accounts = state.accounts.filter(item => item.platform === channel);
      let context: AccountCreationContext['accounts'][number] | undefined; let resolveError = '';
      try { context = resolveAccountCreation(state, project, channel).accountContext?.accounts.find(item => item.platform === channel); } catch (failure) { resolveError = errorMessage(failure); }
      const account = accounts.find(item => item.id === context?.accountId);
      const profile = account ? creationProfileOf(account) : null;
      const selection = project.creationSelections?.[channel];
      return <div className="creation-account-row" key={channel}><div className="creation-account-fields"><Field label={`${PLATFORM_NAMES[channel]}创作账号`}><select disabled={locked} value={account?.id || selection?.accountId || ''} onChange={event => void select(channel, event.target.value)}><option value="">自动跟随当前平台账号</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{account && <Field label="本次创作方案"><select disabled={locked} value={context?.presetId || ''} onChange={event => void select(channel, account.id, event.target.value)}><option value="">使用账号默认方案</option>{profile?.presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}</div>
        {account ? <div className="creation-memory-status"><p className="small-note">{context?.identityMarkdown?.trim() ? `已带入「${account.name}」的身份记忆${context.presetName ? ` · ${context.presetName}` : ''}` : '该账号还未填写身份记忆，当前沿用项目资料与默认规则。'}{!selection && ' · 自动选择'}</p><button type="button" className="text-button" disabled={locked} onClick={() => setEditing(account.id)}>编辑身份与方案</button>{context?.identityMarkdown?.trim() && <details><summary>查看本次身份记忆</summary><pre>{context.identityMarkdown}</pre>{context.topic && <p>内容方向：{context.topic}</p>}{context.instruction && <p className="preserve-lines">方案要求：{context.instruction}</p>}</details>}</div> : <p className="small-note">{resolveError || (accounts.length ? '请选定这个平台的创作账号，避免混用不同账号的身份。' : '尚未添加此平台账号，可在“连接与设置 → 账号与发布”中添加。')}</p>}
      </div>;
    })}
    {error && <p className="error-text" role="alert">{error}</p>}{IS_WEB && <p className="small-note">带私人身份或自装 Skills 的方案需在 Windows 版生成。</p>}
    {editing && <AccountCreationDialog key={editing} accountId={editing} onClose={() => setEditing('')}/>}
  </section>;
}
