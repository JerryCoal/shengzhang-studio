import { useState, type KeyboardEvent } from 'react';
import { Check, Download, ExternalLink, Image, KeyRound, Link2, Pencil, ShieldCheck, Wallet } from 'lucide-react';
import { useStudio } from '../context';
import { api, download, IS_STATIC, IS_WEB, LOCAL_DATA } from '../api';
import { Channel, Field, Modal, PageTitle, Pill } from '../components';
import type { State } from '../types';
import { AISettings } from './AISettings';
import { IntegrationSettings, CommentConnectionSettings } from './Integrations';
import { ContentRulesSettings } from './ContentRules';
import { WebRequestStatus } from './WebRequestStatus';
import { MCPConnections } from './MCPConnections';
import { FeishuSettings } from './Feishu';
import { PublishingNotice } from '../components/PublishingNotice';
import { CREATOR_URLS } from '../../server/content-export.mjs';
import '../workspace-polish.css';

const sections = [
  { id: 'models', label: '文字模型', icon: KeyRound, hint: '配置 OpenAI / DeepSeek / Qwen 密钥，为每个创作环节选择模型。' },
  { id: 'media', label: '图片与视频', icon: Image, hint: '封面和关键帧使用图片模型，短片使用 Seedance。按需配置即可。' },
  { id: 'rules', label: '文案与词库', icon: ShieldCheck, hint: '管理自定义替换、语义检查与敏感词库。' },
  { id: 'publishing', label: '账号与发布', icon: Link2, hint: '连接平台 MCP，管理账号标识与评论读取。模型密钥在文字模型中配置。' },
  { id: 'team', label: '团队协作', icon: Link2, hint: '连接飞书多维表格，自动填写团队发布计划。' },
  { id: 'data', label: '数据与费用', icon: Wallet, hint: '备份工作区、查看模型调用费用和存储方式。' },
] as const;
type Section = typeof sections[number]['id'];
export function openPublishingSettings(go: (page: 'settings') => void) {
  try { sessionStorage.setItem('studio-settings-section', 'publishing'); } catch { /* navigation still works */ }
  go('settings');
}

export function SettingsPage() {
  const { state, settings, run, mutate, busy, notify } = useStudio();
  const [section, setSection] = useState<Section>(() => {
    try { const target = sessionStorage.getItem('studio-settings-section'); return sections.some(s => s.id === target) ? target as Section : 'models'; } catch { return 'models'; }
  });
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const usage = state.projects.flatMap(p => p.usage.map(u => ({ ...u, projectName: p.brief.name })));
  function select(id: Section) { setSection(id); try { sessionStorage.setItem('studio-settings-section', id); } catch { /* optional UI preference */ } }
  function tabKeys(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = e.key === 'ArrowRight' ? (index + 1) % sections.length : e.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : e.key === 'Home' ? 0 : e.key === 'End' ? sections.length - 1 : -1;
    if (next < 0) return; e.preventDefault(); select(sections[next].id); document.getElementById(`settings-tab-${sections[next].id}`)?.focus();
  }
  const localNote = <section className="panel settings-card"><h2>本地创作，随时开始</h2><p className="muted">静态版支持项目资料、模板制作、词库检查、素材导出和评论导入。AI 生成需在完整版连接模型服务；静态版不接收 API 密钥。</p></section>;
  return <div className="settings-workspace">
    <PageTitle eyebrow="YOUR WORKSPACE" title="连接与设置" subtitle="按需连接服务，把工作台调成适合你的样子。"><Pill color="gray">v{settings.version}</Pill></PageTitle>
    <div className="settings-tabs" role="tablist" aria-label="设置分类">{sections.map((item, i) => <button key={item.id} type="button" id={`settings-tab-${item.id}`} role="tab" aria-selected={section === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1} onKeyDown={e => tabKeys(e, i)} onClick={() => select(item.id)}><item.icon size={17}/>{item.label}</button>)}</div>
    <p className="settings-section-hint">{sections.find(s => s.id === section)?.hint}</p>
    {/* Keep panels mounted so switching categories does not discard unfinished form input. */}
    <section id="settings-panel-models" role="tabpanel" aria-labelledby="settings-tab-models" hidden={section !== 'models'}>{IS_STATIC ? localNote : <AISettings/>}</section>
    <section id="settings-panel-media" role="tabpanel" aria-labelledby="settings-tab-media" hidden={section !== 'media'}>{IS_STATIC ? localNote : <IntegrationSettings/>}</section>
    <section id="settings-panel-rules" role="tabpanel" aria-labelledby="settings-tab-rules" hidden={section !== 'rules'}><ContentRulesSettings/></section>
    <section id="settings-panel-publishing" role="tabpanel" aria-labelledby="settings-tab-publishing" hidden={section !== 'publishing'}>
      <MCPConnections/>
      <section className="panel settings-card account-settings"><div className="section-heading"><div><h2>本地账号标识</h2><p className="muted">这里的名称仅用于区分发布记录，不会登录或修改平台账号。</p></div><Pill color="green">手动发布</Pill></div>
        <div className="manual-account-grid">{state.accounts.map(account => <article className="manual-account" key={account.id}><div className="row between"><Channel platform={account.platform}/><button className="icon-button" aria-label={`修改账号名称 ${account.name}`} onClick={() => setRename({ id: account.id, name: account.name })}><Pencil size={16}/></button></div><h3>{account.name}</h3><p>到平台后，请核对实际登录的账号。</p><a className="button small" href={CREATOR_URLS[account.platform]} target="_blank" rel="noreferrer">打开创作中心 <ExternalLink size={14}/></a></article>)}</div>
        <PublishingNotice/>
      </section>
      {!IS_STATIC && <CommentConnectionSettings/>}
    </section>
    <section id="settings-panel-team" role="tabpanel" aria-labelledby="settings-tab-team" hidden={section !== 'team'}><FeishuSettings/></section>
    <section id="settings-panel-data" role="tabpanel" aria-labelledby="settings-tab-data" hidden={section !== 'data'}>
      {IS_WEB && <WebRequestStatus/>}
      <div className="settings-grid"><section className="panel settings-card"><div className="section-heading"><h2>工作区数据</h2><ShieldCheck size={20}/></div>
        <div className="setting-row"><span>存储方式</span><b>{LOCAL_DATA ? '当前浏览器 · 按用户加密' : settings.profileMode ? '本机 SQLite · 按用户加密' : '本地 SQLite 数据库'}</b></div>
        <div className="setting-row"><span>访问保护</span><Pill color={settings.authEnabled ? 'green' : 'gray'}>{settings.authEnabled ? '密码登录已启用' : '本机访问'}</Pill></div>
        <p className="muted">{LOCAL_DATA ? '当前用户的数据由登录密码加密保存。清除浏览器数据后无法恢复；请定期导出备份。不同设备和浏览器不会自动同步。' : settings.profileMode ? '用户数据分别加密保存在本机。更新应用不会删除数据；请牢记密码，密码无法找回。' : '项目、策略、成品、发布记录和评论会持久保存在本地数据库。'}</p>
        <p className="small-note">备份为明文文件，包含项目和素材，不包含 API 密钥。请妥善保存。</p>
        <button className="button primary" disabled={busy} onClick={() => void run(async () => { const data = await api<State>('/backup'); download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `生长工作区备份-${new Date().toISOString().slice(0, 10)}.json`); notify('完整工作区备份已导出'); })}><Download size={16}/>导出完整备份</button>
        {settings.authEnabled && <button className="text-button muted logout-button" onClick={() => void run(async () => { await api('/logout', 'POST'); sessionStorage.removeItem('studio-session'); location.reload(); })}>退出工作区</button>}
        <details className="settings-details"><summary>在其他设备上使用</summary><p>{LOCAL_DATA ? '网页版可在手机和电脑打开，各自保存本地数据。使用 HTTPS 时可添加到主屏幕。' : settings.profileMode ? 'Windows 应用菜单中的“在浏览器中打开”可访问同一个工作区。当前不提供手机远程访问和跨设备同步。' : '浏览器可访问已部署的后端地址。安卓和 iOS 原生应用仍需构建、签名及真机验证。'}</p></details>
      </section><section className="panel settings-card"><div className="section-heading"><h2>费用记录</h2><Wallet size={20}/></div><div className="cost-number">${usage.reduce((sum, u) => sum + u.amountUsd, 0).toFixed(3)}<small>估算费用，含未完成请求预留</small></div><p className="muted">按调用模型与当时单价记录，最终金额以服务商账单为准。</p>{usage.length ? <div className="usage-list">{usage.slice(-10).reverse().map(u => <div key={u.id}><span>{u.projectName}<small>{u.model} · {u.note}</small></span><b>${u.amountUsd.toFixed(4)}</b></div>)}</div> : <div className="no-usage"><Check size={16}/>还没有模型调用，本地体验费用为 $0。</div>}</section></div>
    </section>
    {rename && <Modal title="修改本地账号标识" description="此名称用于发布记录，不会登录或修改平台账号。" onClose={() => setRename(null)}><form onSubmit={e => { e.preventDefault(); void run(async () => { await mutate(`/accounts/${rename.id}`, 'PATCH', { name: rename.name }); notify('账号名称已保存'); setRename(null); }); }}><Field label="账号名称"><input required maxLength={100} value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })}/></Field><div className="modal-actions"><button type="button" className="button" onClick={() => setRename(null)}>取消</button><button className="button primary" disabled={busy}>保存</button></div></form></Modal>}
  </div>;
}
