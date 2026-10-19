import { useCallback, useEffect, useRef, useState } from 'react';
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
  const live = useRef(true), serial = useRef(0);
  const reload = useCallback(async () => { const request = ++serial.current; try { const next = await api<Integrations>('/integrations'); if (live.current && request === serial.current) { setValue(next); setError(''); } } catch (e) { if (live.current && request === serial.current) setError(e instanceof Error ? e.message : '无法读取连接设置'); } }, []);
  useEffect(() => { live.current = true; const changed = () => { void reload(); }; void reload(); window.addEventListener('studio-integrations-changed', changed); return () => { live.current = false; serial.current++; window.removeEventListener('studio-integrations-changed', changed); }; }, [reload]);
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
  if (!value) return <p className="muted">正在读取图片与视频连接…</p>;
  const editable = value.local;
  return <section className="panel integration-settings">
    <div className="section-heading"><div><h2>图片与视频连接</h2><p className="muted">配置图片和视频模型，已保存的密钥会显示连接状态。</p></div><button className="button small" disabled={busy} onClick={() => void run(changed)}><RefreshCw size={15}/>刷新状态</button></div>
    <div className="service-grid">
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

    </div>

    {!editable && <p className="info-box">请在运行服务的电脑上打开本地地址，配置图片与视频密钥。</p>}
    {deleteService && <div className="info-box delete-key"><p>删除{deleteService === 'seedream' ? ' Seedream 密钥后，需重新填写才能使用 Seedream 生图，已保存的关键帧保留。' : ' Seedance 密钥后，需重新填写才能生成视频。'}</p><button className="button danger small" disabled={busy} onClick={() => void run(async () => { await api(`/integrations/${deleteService}`, 'DELETE'); setDeleteService(''); await changed(); notify('本机凭证已删除'); })}>确认删除</button><button className="button small" onClick={() => setDeleteService('')}>保留</button></div>}
  </section>;
}

export function CommentConnectionSettings() {
  const { value, error, reload } = useIntegrations();
  const { run, busy, refresh, notify } = useStudio();
  const [deleting, setDeleting] = useState(false);
  const changed = async () => { await reload(); await refresh(); };
  return <details className="panel comment-connection"><summary>抖音评论读取 · 可选设置<small>仅限已有接口权限的用户；不影响素材导出和手动发布。</small></summary>
    {error && <div className="info-box">{error}<button className="button small" onClick={() => void reload()}>重新加载</button></div>}
    {!value && !error && <p className="muted">正在读取评论连接…</p>}
    {value && <DouyinSettings value={value} changed={changed} onDelete={() => setDeleting(true)}/>}
    {deleting && <div className="info-box delete-key"><p>删除抖音凭证会停止评论同步，平台中的作品保留。平台授权可另行在抖音撤销。</p><button className="button danger small" disabled={busy} onClick={() => void run(async () => { await api('/integrations/douyin', 'DELETE'); setDeleting(false); await changed(); notify('抖音评论连接已删除'); })}>确认删除</button><button className="button small" onClick={() => setDeleting(false)}>保留</button></div>}
  </details>;
}
