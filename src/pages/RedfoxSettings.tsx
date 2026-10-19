import { useEffect, useState } from 'react';
import { Check, Globe, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { api, LOCAL_DATA } from '../api';
import { useStudio } from '../context';
import { Channel, Field, Modal, Pill } from '../components';
import { useIntegrations } from './Integrations';
import type { RedfoxIntegration } from '../types';
import '../redfox.css';

export const redfoxMoney = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}` : '费用待核实';
export function openRedfoxSettings(go: (page: 'settings') => void) {
  try { sessionStorage.setItem('studio-settings-section', 'redfox'); } catch { /* Navigation still works. */ }
  window.dispatchEvent(new CustomEvent('studio-settings-open', { detail: 'redfox' })); go('settings');
}
export function RedfoxRouteNotice({ value, purpose }: { value?: RedfoxIntegration; purpose: 'media' | 'search' | 'data' }) {
  const { go } = useStudio();
  const active = !!value?.configured && !!value.supported && (purpose === 'media' ? value.mediaEnabled : purpose === 'search' ? value.searchEnabled : value.enabled);
  if (!active) return null;
  return <div className="info-box redfox-route-notice"><div><b>本次通过 Redfox · 测试版</b><p>{purpose === 'media' ? '提示词与参考素材将交给 Redfox：图片固定使用 Seedream 5.0 Pro，视频使用 Seedance 2.0。关闭此路由可恢复原有 GPT Image / 方舟服务。' : purpose === 'search' ? '联网搜索将通过 Redfox 获取参考内容。' : '公开平台资料将通过 Redfox 读取；不会改变平台登录或发布连接。'}费用按人民币单独记录，以 Redfox 账单为准。</p></div><button type="button" className="text-button" onClick={() => openRedfoxSettings(go)}>查看路由设置</button></div>;
}
function ConnectedRedfoxSettings() {
  const { settings, busy, run, refresh, notify } = useStudio();
  const { value, error, reload } = useIntegrations();
  const redfox = value?.redfox;
  const [key, setKey] = useState('');
  const [routes, setRoutes] = useState({ enabled: false, mediaEnabled: false, searchEnabled: false });
  const [remove, setRemove] = useState(false);
  useEffect(() => { if (redfox) setRoutes({ enabled: redfox.enabled, mediaEnabled: redfox.mediaEnabled, searchEnabled: redfox.searchEnabled }); }, [redfox?.configured, redfox?.enabled, redfox?.mediaEnabled, redfox?.searchEnabled]);
  const editable = !!value?.local && !!redfox?.supported && (!settings.team || settings.team.role === 'admin');
  const changed = !!key.trim() || !!redfox?.configured && (routes.enabled !== redfox.enabled || routes.mediaEnabled !== redfox.mediaEnabled || routes.searchEnabled !== redfox.searchEnabled);
  const reloadSaved = async () => { await reload(); await refresh(); window.dispatchEvent(new Event('studio-integrations-changed')); };
  const status = !redfox?.configured ? '未配置' : redfox.lastError ? '最近请求失败' : redfox.verifiedAt ? '已有实际请求验证' : '已保存，待实际请求验证';
  return <section className="panel settings-card redfox-settings" aria-label="Redfox 测试版设置">
    <div className="section-heading"><div><h2><Globe size={20}/> Redfox · 测试版</h2><p className="muted">统一配置平台资料读取、图片与视频生成、联网搜索的服务密钥。</p></div><Pill color={redfox?.lastError ? 'amber' : redfox?.verifiedAt ? 'green' : 'gray'}>{status}</Pill></div>
    {error && <p className="info-box" role="alert">{error}</p>}
    {!value && !error && <p className="muted" role="status">正在读取已保存设置…</p>}
    {value && !redfox && <p className="info-box">当前后端尚未提供 Redfox 测试版，请更新工作站后再配置。</p>}
    {redfox && <>
      <p className="info-box">保存密钥只更新当前工作区配置，不会自动启用下方路由或发出收费请求。请主动选择需要的能力；真正读取资料或生成内容时才调用。关闭任一路由可恢复原有服务设置。</p>
      {!editable && <p className="small-note">{settings.team && settings.team.role !== 'admin' ? '当前账号可查看设置；密钥和路由由团队管理员管理。' : redfox.problem || '当前环境无法安全保存 Redfox 密钥，请在完整后端工作区配置。'}</p>}
      <form autoComplete="off" onSubmit={event => { event.preventDefault(); if (busy || !editable || !changed) return; const submitted = key.trim(); setKey(''); void run(async () => { await api('/integrations/redfox', 'PUT', { ...(submitted ? { apiKey: submitted } : {}), ...routes }); await reloadSaved(); notify('Redfox 配置已保存；后续实际请求使用已开启的路由。'); }); }}>
        <Field label="Redfox API Key" hint={redfox.configured ? `已加密保存 · 末尾 ${redfox.suffix || '已隐藏'}；留空保留当前密钥。` : '由工作站后端加密保存，项目导出不包含密钥。'}><input type="password" autoComplete="new-password" maxLength={2048} spellCheck={false} disabled={busy || !editable} value={key} onChange={event => setKey(event.target.value)} placeholder={redfox.configured ? '留空保留，填写可替换' : '填写 Redfox API Key'}/></Field>
        <fieldset className="redfox-route-options" disabled={busy || !editable}><legend>通过 Redfox 使用哪些能力</legend>
          <label><input type="checkbox" checked={routes.enabled} onChange={event => setRoutes({ ...routes, enabled: event.target.checked })}/><span><b>平台资料读取</b><small>用于已支持平台的同话题搜索、评论和作品指标；发布连接保持原设置。</small></span></label>
          <label><input type="checkbox" checked={routes.mediaEnabled} onChange={event => setRoutes({ ...routes, mediaEnabled: event.target.checked })}/><span><b>图片与视频生成</b><small>本版使用 Seedream 5 Pro 生成图片与首尾帧，Seedance 2.0 生成视频。原有 GPT Image 和方舟配置保留。</small></span></label>
          <label><input type="checkbox" checked={routes.searchEnabled} onChange={event => setRoutes({ ...routes, searchEnabled: event.target.checked })}/><span><b>联网搜索</b><small>在需要联网搜索的研究流程中使用 Redfox；文字分析继续使用所选模型。</small></span></label>
        </fieldset>
        <div className="redfox-actions"><button className="button primary" disabled={busy || !editable || !changed || !redfox.configured && !key.trim()}><KeyRound size={16}/>保存密钥与路由</button><button type="button" className="button" disabled={busy} onClick={() => void run(reloadSaved)}><RefreshCw size={15}/>刷新已保存状态</button>{changed && <span className="small-note">有未保存修改。</span>}</div>
      </form>
      {redfox.problem && <p className="error-text" role="alert">{redfox.problem}</p>}
      {redfox.lastError && <p className="error-text" role="alert">最近一次请求：{redfox.lastError}</p>}
      {redfox.verifiedAt && <p className="small-note">最近实际请求验证：{new Date(redfox.verifiedAt).toLocaleString('zh-CN')}。此记录不代表所有接口或余额均已验证。</p>}
      <section className="redfox-capabilities"><h3>本版已接入的平台读取能力</h3><p className="small-note">以下是工作站已接入的接口范围，实际可用性以请求结果为准。</p><div className="redfox-capability-list">{redfox.capabilities.map(capability => <article key={capability.platform}><Channel platform={capability.platform}/><div className="redfox-capability-tags">{([['搜索', capability.search], ['作品详情 / 指标', capability.detail], ['评论', capability.comments]] as const).map(([label, supported]) => <span key={label} className={supported ? 'available' : ''}>{supported ? '✓' : '—'} {label}</span>)}</div><p className="small-note">{capability.note}</p></article>)}</div></section>
      <div className="redfox-usage"><h3>Redfox 人民币费用记录</h3><p><b>{(redfox.usage?.requests ?? 0).toLocaleString()}</b> 次已记录请求 · 估算 <b>{redfoxMoney(redfox.usage?.estimatedCny)}</b></p><p className="small-note">与原有美元模型费用分开记录，不作汇率换算。请求数不是成功结果数；最终费用和余额以服务商账单为准。</p></div>
      {!!redfox.notes?.length && <ul className="redfox-notes">{redfox.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {redfox.configured && <button className="text-button muted" disabled={busy || !editable} onClick={() => setRemove(true)}><Trash2 size={14}/>删除 Redfox 密钥</button>}
    </>}
    {remove && <Modal title="删除 Redfox 密钥" description="已有素材、研究参考和费用记录会保留。后续使用原有服务时仍需对应密钥与配置。" onClose={() => { if (!busy) setRemove(false); }}><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={() => setRemove(false)}>保留</button><button type="button" className="button danger" disabled={busy || !editable} onClick={() => void run(async () => { await api('/integrations/redfox', 'DELETE'); setKey(''); setRemove(false); await reloadSaved(); notify('Redfox 密钥已删除'); })}>确认删除</button></div></Modal>}
  </section>;
}
export function RedfoxSettings() {
  const { settings } = useStudio();
  if (LOCAL_DATA || settings.browserStorage) return <section className="panel settings-card"><h2><Globe size={20}/> Redfox · 测试版</h2><p className="info-box">请在 Windows 完整版或团队后端工作区配置 Redfox。当前浏览器本地模式尚未接入该服务。</p><p className="small-note"><Check size={14}/>已有连接与创作内容继续保留。</p></section>;
  return <ConnectedRedfoxSettings/>;
}
