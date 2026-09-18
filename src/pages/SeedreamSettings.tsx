import { useState, useEffect, useRef } from 'react';
import { CircleHelp, ImagePlus, LockKeyhole } from 'lucide-react';
import { api, IS_WEB } from '../api';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import { SeedreamHelp, SEEDREAM_HELP_TITLE } from '../SeedreamHelp';
import type { Integrations, SeedreamSettings as Configuration } from '../types';
import { SEEDREAM_MODELS } from '../../server/seedream-config.mjs';

export function SeedreamSettings({ value, changed, onDelete }: { value: Integrations; changed: () => Promise<void>; onDelete: () => void }) {
  const { run, busy, notify } = useStudio();
  const [config, setConfig] = useState<Configuration>(value.seedream), [key, setKey] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeHelp = () => { setShowHelp(false); requestAnimationFrame(() => helpButton.current?.focus()); };
  useEffect(() => { const { family, model, reservationUsd, imagePriceUsd } = value.seedream; setConfig({ family, model, reservationUsd, imagePriceUsd }); }, [value.seedream]);
  const editable = value.local && !busy;
  return <article className="service-card">
    <div className="service-title"><ImagePlus size={21}/><h3>Seedream 封面与关键帧</h3><Pill color={value.seedream.configured ? 'green' : 'gray'}>{value.seedream.configured ? '密钥已保存 · 待实测' : '待配置'}</Pill></div>
    <p>火山方舟 · 中国北京。生成小红书封面，或生成视频首尾帧，再交给 Seedance 制作视频。支持产品图参考，复用同一份图片密钥。</p>
    <form autoComplete="off" onSubmit={e => { e.preventDefault(); const submitted = key.trim(); setKey(''); void run(async () => { await api('/integrations/seedream', 'PUT', { settings: config, ...(submitted ? { apiKey: submitted } : {}) }); await changed(); notify('Seedream 已加密保存，可在内容制作中生成 AI 封面或视频关键帧'); }); }}>
      <Field label="Seedream 模型系列" hint="选择已在火山方舟开通的系列；更换系列会填入对应的模型 ID。"><select disabled={!editable} value={config.family} onChange={e => { const family = e.target.value as Configuration['family']; setConfig({ ...config, family, model: SEEDREAM_MODELS[family].model }); }}>{Object.entries(SEEDREAM_MODELS).map(([family, model]) => <option key={family} value={family}>{model.label}</option>)}</select></Field>
      <Field label="Seedream 模型 / 接入点 ID" hint="可使用预填型号，或粘贴北京区域的 ep- 接入点。接入点的模型系列需与上方一致。"><input required disabled={!editable} maxLength={120} spellCheck={false} value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })}/></Field>
      <button ref={helpButton} type="button" className="text-button seedream-help-link" aria-haspopup="dialog" onClick={() => setShowHelp(true)}><CircleHelp size={14} aria-hidden="true"/>是不是提示“模型或者接入点不存在”</button>
      <Field label="Seedream API Key" hint={value.seedream.configured ? `已加密保存 · 末尾 ${value.seedream.suffix}；留空保留当前密钥` : IS_WEB ? '按当前用户加密保存在此浏览器，生成时临时解密。' : '按当前用户加密保存在本机，项目备份不包含密钥。'}><input type="password" autoComplete="off" maxLength={512} disabled={!editable || !value.seedream.supported} value={key} onChange={e => setKey(e.target.value)} placeholder={value.seedream.configured ? '留空保留现有密钥' : '填写火山方舟 API Key'}/></Field>
      <div className="service-fields"><Field label="每张图预算预留（美元）"><input type="number" required min={.01} max={100} step={.01} disabled={!editable} value={config.reservationUsd} onChange={e => setConfig({ ...config, reservationUsd: Number(e.target.value) })}/></Field><Field label="图片单价（美元 / 张）"><input type="number" required min={0} max={100} step={.001} disabled={!editable} value={config.imagePriceUsd} onChange={e => setConfig({ ...config, imagePriceUsd: Number(e.target.value) })}/></Field></div>
      <p className="small-note">小红书封面为 1728 × 2304（3:4），视频关键帧为 1440 × 2560（9:16）。请按账户型号和分辨率填写单价，人民币需换算；填 0 时保留预算预留。每次按预留与单价中较高者检查项目预算，实际以账单为准。</p>
      <button className="button primary full" disabled={!editable || !config.model.trim() || (!value.seedream.configured && !key.trim())}><LockKeyhole size={16}/>保存图片连接</button>
    </form>
    <div className="authorization-step"><Field label="默认关键帧服务" hint="选择后立即保存，也可在每次生成时临时切换。"><select disabled={!editable} value={value.imageProvider} onChange={e => { const provider = e.target.value; void run(async () => { await api('/integrations/image-provider', 'PUT', { provider }); await changed(); notify('默认关键帧服务已保存'); }); }}><option value="openai">OpenAI · GPT Image 2</option><option value="seedream">火山方舟 · Seedream</option></select></Field></div>
    {value.seedream.problem && <p className="error-text">{value.seedream.problem}</p>}
    {value.seedream.configured && <button className="text-button muted" disabled={!editable} onClick={onDelete}>删除 Seedream 本机密钥</button>}
    <a className="service-doc" href="https://www.volcengine.com/docs/82379/1541523" target="_blank" rel="noreferrer">Seedream 官方接口说明 ↗</a>
    {showHelp && <Modal title={`Q：${SEEDREAM_HELP_TITLE}`} description="按顺序排查，关闭说明即可继续填写；当前未保存的输入会保留。" wide onClose={closeHelp}><SeedreamHelp/><div className="seedream-help-footer"><button type="button" className="button primary" onClick={closeHelp}>返回填写 Seedream 设置</button></div></Modal>}
  </article>;
}
