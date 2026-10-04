import { useEffect, useState } from 'react';
import { LockKeyhole, RefreshCw, Video } from 'lucide-react';
import { api, IS_WEB } from '../api';
import { useStudio } from '../context';
import { Field, Pill } from '../components';
import type { Integrations } from '../types';
import '../integrations.css';
import { DouyinSettings } from './DouyinSettings';
import { SeedreamSettings } from './SeedreamSettings';

export function useIntegrations() {
  const [value, setValue] = useState<Integrations | null>(null), [error, setError] = useState('');
  const reload = async () => { try { setValue(await api<Integrations>('/integrations')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '无法读取连接设置'); } };
  useEffect(() => { void reload(); }, []);
  return { value, error, reload };
}
export function IntegrationSettings() {
  const { value, error, reload } = useIntegrations();
  const { run, busy, refresh, notify } = useStudio();
  const [seedKey, setSeedKey] = useState(''), [region, setRegion] = useState<'volcengine' | 'byteplus'>('volcengine'), [model, setModel] = useState('');
  const [reservation, setReservation] = useState(2), [price, setPrice] = useState(0);
  const [deleteService, setDeleteService] = useState('');
  useEffect(() => { if (value) { setRegion(value.seedance.region); setModel(value.seedance.model); setReservation(value.seedance.reservationUsd); setPrice(value.seedance.outputPriceUsd); } }, [value]);
  const changed = async () => { await reload(); await refresh(); };
  if (error) return <div className="info-box"><span>{error}</span><button className="button small" onClick={() => void reload()}>重新加载连接</button></div>;
  if (!value) return <p className="muted">正在读取生成与发布连接…</p>;
  const editable = value.local;
  return <section className="panel integration-settings">
    <div className="section-heading"><div><h2>生成与平台连接</h2><p className="muted">封面 / 关键帧 → 视频 → 发布 → 评论，按需要启用。</p></div><button className="button small" disabled={busy} onClick={() => void run(changed)}><RefreshCw size={15}/>刷新状态</button></div>
    <div className="info-box">{IS_WEB ? "网页版需保持原工作区页面打开并联网，才能按时投稿和同步评论。浏览器休眠、关闭或退出登录时会暂停；重新打开后继续查询已保存的任务。" : "自动任务需要保持应用和本地服务运行。"}</div><div className="service-grid">
      <SeedreamSettings value={value} changed={changed} onDelete={() => setDeleteService('seedream')}/>
      <article className="service-card"><div className="service-title"><Video size={21}/><h3>Seedance 视频生成</h3><Pill color={value.seedance.configured ? 'green' : 'gray'}>{value.seedance.configured ? '密钥已保存 · 待实测' : '待配置'}</Pill></div>
        <p>先选择 <b>GPT Image 2 或 Seedream</b> 生成首尾关键帧，再由 Seedance 生成短片。视频密钥单独保存；如果使用同一个火山方舟密钥，可在两处分别填写。</p>
        <form autoComplete="off" onSubmit={e => { e.preventDefault(); const submitted = seedKey; setSeedKey(''); void run(async () => { await api('/integrations/seedance', 'PUT', { region, model, reservationUsd: reservation, outputPriceUsd: price, ...(submitted.trim() ? { apiKey: submitted.trim() } : {}) }); await changed(); notify('Seedance 配置已保存；可到内容制作检查并生成关键帧'); }); }}>
          <Field label="Seedance 服务区域" hint="密钥、模型与服务区域必须来自同一控制台。"><select disabled={!editable || busy} value={region} onChange={e => setRegion(e.target.value as typeof region)}><option value="volcengine">火山方舟 · 中国北京</option><option value="byteplus">BytePlus ModelArk · 新加坡</option></select></Field>
          <Field label="Seedance 模型 / 接入点 ID" hint="从控制台复制已开通的 Seedance 模型或 ep- 接入点，选择支持首尾帧的型号。"><input required value={model} maxLength={120} spellCheck={false} disabled={!editable || busy} onChange={e => setModel(e.target.value)} placeholder="粘贴模型 ID 或 ep-…"/></Field>
          <Field label="Seedance API Key" hint={value.seedance.configured ? `已加密保存 · 末尾 ${value.seedance.suffix}；留空保留当前密钥` : IS_WEB ? '由本地登录密码加密保存在浏览器；联网调用时临时解密。' : '使用 Windows 当前用户加密，仅在这台电脑上使用。'}><input type="password" autoComplete="off" disabled={!editable || !value.seedance.supported || busy} maxLength={512} value={seedKey} onChange={e => setSeedKey(e.target.value)} placeholder={value.seedance.configured ? '留空保留现有密钥' : '填写官方 API Key'}/></Field>
          <div className="service-fields"><Field label="每段视频预算预留（美元）"><input type="number" min={0.1} max={100} step={0.1} value={reservation} disabled={!editable || busy} onChange={e => setReservation(Number(e.target.value))}/></Field><Field label="视频单价（美元 / 百万 token）"><input type="number" min={0} max={1000} step={0.01} value={price} disabled={!editable || busy} onChange={e => setPrice(Number(e.target.value))}/></Field></div>
          <p className="small-note">请按自己账户的型号与音频档位填写单价；人民币报价请先换算。填 0 时只记录预算预留。预留金额用于项目预算检查，不是服务商收费上限。</p>
          <button className="button primary full" disabled={!editable || busy || !model.trim() || (!value.seedance.configured && !seedKey.trim())}><LockKeyhole size={16}/>保存视频连接</button>
        </form>
        {value.seedance.problem && <p className="error-text">{value.seedance.problem}</p>}
        {value.seedance.configured && <button className="text-button muted" disabled={busy || !editable} onClick={() => setDeleteService('seedance')}>删除 Seedance 本机密钥</button>}
        <a className="service-doc" href={region === 'volcengine' ? 'https://www.volcengine.com/docs/82379/1520757' : 'https://docs.byteplus.com/en/docs/ModelArk/1520757'} target="_blank" rel="noreferrer">Seedance 官方接口说明 ↗</a>
      </article>
      <DouyinSettings value={value} changed={changed} onDelete={() => setDeleteService('douyin')}/>
    </div>
    <div className="platform-boundary"><b>小红书</b><p>目前保留素材导出、手动发布和评论导入。查到的官方分享 SDK 需要在小红书客户端完成发布，尚未找到可据此接入的通用后台发笔记及评论采集接口。</p><a href="https://agora.xiaohongshu.com/doc" target="_blank" rel="noreferrer">查看官方分享文档 ↗</a></div>
    {!editable && <p className="info-box">个人凭证由运行服务的电脑保管。请在该电脑的本地地址完成配置与自动任务授权。</p>}
    {deleteService && <div className="info-box delete-key"><p>删除{deleteService === 'douyin' ? '抖音凭证会停止后续自动发布和评论同步，平台中已有作品保留。平台授权可另外在抖音中撤销。' : deleteService === 'seedream' ? ' Seedream 密钥后，需重新填写才能使用 Seedream 生图，已保存的关键帧保留。' : ' Seedance 密钥后，需重新填写才能生成视频。'}</p><button className="button danger small" disabled={busy} onClick={() => void run(async () => { await api(`/integrations/${deleteService}`, 'DELETE'); setDeleteService(''); await changed(); notify('本机凭证已删除'); })}>确认删除</button><button className="button small" onClick={() => setDeleteService('')}>保留</button></div>}
  </section>;
}
