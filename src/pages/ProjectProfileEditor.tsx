import { useState, type FormEvent } from 'react';
import { useStudio } from '../context';
import { useProjectAutosave } from '../useProjectAutosave';
import { Field, Modal } from '../components';
import { ProjectBriefImport } from '../components/ProjectBriefImport';
import type { Brief, Project } from '../types';

const fresh = (): Brief => ({ name: '', brand: '未提供', product: '未提供', type: 'daily', goal: '持续创作与运营', audience: '按所选账号及本次需求确定', sellingPoints: '未提供，生成时不得编造', facts: '', requirements: '真实、清晰，不编造事实或亲身经历。', channels: ['xiaohongshu'], deadline: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), budgetUsd: 10 });
export function ProjectProfileEditor({ existing, onClose }: { existing?: Project; onClose: () => void }) {
  const { mutate, run, busy, notify, go, refresh } = useStudio();
  const { brief, set, applyPatch, ready, status, error, flush, discardSavedDraft, restoreCurrent } = useProjectAutosave(existing?.brief || fresh(), existing);
  const [advanced, setAdvanced] = useState(false);
  const close = () => { if (!busy) void run(async () => { await flush(); await refresh(); onClose(); }); };
  const submit = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const saved = await flush();
    if (saved?.draft.conflict) throw new Error('项目资料已在其他窗口变更。请核对后保存，当前草稿已保留。');
    if (existing) { await refresh(); notify('项目长期资料已保存'); onClose(); return; }
    const result = await mutate<Project>('/projects', 'POST', { ...brief, type: 'daily', editorDraftVersion: saved?.draft.version });
    await discardSavedDraft(); notify('项目已创建，可以直接描述第一篇内容'); onClose(); go('studio', result.result.id, { newContent: true });
  }); };
  return <Modal title={existing ? '项目长期资料' : '创建项目'} description="项目保存长期资料；每篇内容的主题、用途和场景，在创作时描述。" onClose={close} wide>
    <div className={`autosave-status ${error ? 'error' : ''}`} role="status">{status}{error && ready && <button className="text-button" onClick={() => void run(flush)}>重试保存</button>}{error && existing && <button className="text-button" onClick={() => void run(restoreCurrent)}>恢复最新项目资料</button>}</div>
    <form onSubmit={submit}><fieldset disabled={!ready || busy} className="editor-fields simple-project-fields">
      <Field label="项目名称"><input required maxLength={100} value={brief.name} onChange={e => set('name', e.target.value)} placeholder="例如：学习账号矩阵"/></Field>
      <Field label="品牌或栏目名称（可选）"><input maxLength={100} value={brief.brand === '未提供' ? '' : brief.brand} onChange={e => set('brand', e.target.value || '未提供')}/></Field>
      <Field label="长期方向与表达要求"><textarea rows={3} maxLength={2000} value={brief.requirements} onChange={e => set('requirements', e.target.value)} placeholder="账号风格在账号身份里维护；这里记录项目共用要求。"/></Field>
      <Field label="已确认的资料与事实（可选）"><textarea rows={4} maxLength={8000} value={brief.facts} onChange={e => set('facts', e.target.value)} placeholder="品牌介绍、产品规格、可核实的服务范围；没有就留空。"/></Field>
      <details className="workflow-secondary" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>更多项目资料与费用设置</summary>
        <ProjectBriefImport editorKey={existing?.id || 'new'} brief={brief} ready={ready} flush={flush} applyPatch={applyPatch} onOpenSettings={() => void run(async () => { await flush(); await refresh(); onClose(); go('settings'); })}/>
        <Field label="产品或服务（可选）"><input maxLength={100} value={brief.product === '未提供' ? '' : brief.product} onChange={e => set('product', e.target.value || '未提供')}/></Field>
        <Field label="长期运营目标"><textarea rows={2} maxLength={1000} value={brief.goal} onChange={e => set('goal', e.target.value)}/></Field>
        <Field label="默认受众"><textarea rows={2} maxLength={1000} value={brief.audience} onChange={e => set('audience', e.target.value)}/></Field>
        <Field label="已确认的特点与卖点"><textarea rows={2} maxLength={2000} value={brief.sellingPoints} onChange={e => set('sellingPoints', e.target.value)}/></Field>
        <Field label="模型预算上限（USD）" hint="新建项目使用默认预算；每次付费操作继续显示费用并按原流程确认。"><input type="number" required min={0} max={10000} step="0.01" value={brief.budgetUsd} onChange={e => set('budgetUsd', Number(e.target.value))}/></Field>
        <Field label="项目计划日期"><input type="date" value={brief.deadline} onChange={e => set('deadline', e.target.value)}/></Field>
        {brief.nurture && <details><summary>历史版本创作要求</summary><p className="small-note">历史养号资料继续保留，旧内容不受影响；新内容请在创作时描述需求。</p>{(['topic', 'scene', 'copyPrompt'] as const).map(key => <Field key={key} label={{ topic: '原主题', scene: '原场景', copyPrompt: '原文案要求' }[key]}><textarea rows={2} maxLength={key === 'topic' ? 100 : key === 'scene' ? 2000 : 4000} value={brief.nurture![key]} onChange={e => set('nurture', { ...brief.nurture!, [key]: e.target.value })}/></Field>)}</details>}
      </details>
      <div className="modal-actions"><button type="button" className="button" onClick={close}>保存并关闭</button><button className="button primary" disabled={busy || !ready || !brief.name.trim()}>{existing ? '保存资料' : '创建并开始创作'}</button></div>
    </fieldset></form>
  </Modal>;
}
