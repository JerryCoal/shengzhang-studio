import { useEffect, useState } from 'react';
import { Field } from '../components';
import { useStudio } from '../context';
import { api } from '../api';
import { defaultLocalQwen, type LocalQwenConnection } from '../../server/local-qwen-connection.mjs';

export function LocalQwenSettings() {
  const { settings, busy, run, refresh, notify } = useStudio();
  const service = settings.providers?.['local-qwen'];
  const saved = service?.localConnection || defaultLocalQwen;
  const [value, setValue] = useState<LocalQwenConnection>({ ...saved }), [key, setKey] = useState('');
  useEffect(() => setValue({ ...saved }), [JSON.stringify(saved)]);
  const editable = !!service?.credential.local && (!settings.team || settings.team.role === 'admin');
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  return <div className="local-qwen-settings">
    <p className="info-box">独立使用自行部署的 Qwen，不替换百炼官方连接。只连接运行工作站的主机；团队成员连接的是团队主机，不是自己的电脑。不自动安装、启动或下载模型。</p>
    {!editable && <p role="alert">{settings.team ? '请联系管理员在团队主机配置本地模型。' : '此入口请在 Windows 完整版或团队工作区使用，静态网页与网站中转不访问内网。'}</p>}
    <Field label="本机服务类型"><select value={value.engine} disabled={busy || !editable} onChange={event => setValue({ ...value, engine: event.target.value as LocalQwenConnection['engine'], baseUrl: event.target.value === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:8000/v1' })}><option value="ollama">Ollama · OpenAI 兼容接口</option><option value="openai">vLLM / 其他 OpenAI 兼容服务</option></select></Field>
    <Field label="主机本地 Base URL" hint="只接受 127.0.0.1 或 [::1]，端口 1024–65535，路径 /v1；localhost 会转为 127.0.0.1。拒绝远程 IP、代理地址和重定向。"><input value={value.baseUrl} maxLength={200} spellCheck={false} disabled={busy || !editable} onChange={event => setValue({ ...value, baseUrl: event.target.value })}/></Field>
    <Field label="实际模型 ID" hint="必须与本机 /v1/models 返回的 ID 完全一致。请使用支持 JSON 的 Qwen 指令模型和本地权重，不使用 cloud 模型或云端转发。"><input value={value.model} placeholder={value.engine === 'ollama' ? '例如 qwen3:8b（需先在本机安装）' : '例如 Qwen/Qwen3-8B'} maxLength={200} spellCheck={false} disabled={busy || !editable} onChange={event => setValue({ ...value, model: event.target.value })}/></Field>
    <label className="checkbox-row"><input type="checkbox" checked={value.enabled} disabled={busy || !editable} onChange={event => setValue({ ...value, enabled: event.target.checked })}/>保存后启用此本机连接</label>
    <button type="button" className="button primary" disabled={busy || !editable || !dirty || !value.model.trim()} onClick={() => void run(async () => { await api('/settings/providers/local-qwen/connection', 'PUT', value); await refresh(); notify('本地连接已保存，尚未连接服务；请手动检查'); })}>保存本地连接</button>
    <Field label="本机 API Key（可选）" hint="Ollama 通常留空；vLLM 启用 --api-key 时填写该本机服务的密钥。与官方 Qwen 密钥分开加密，不进入备份。"><input type="password" value={key} maxLength={512} autoComplete="off" disabled={busy || !editable || !service?.credential.supported} onChange={event => setKey(event.target.value)}/></Field>
    <div className="row gap-10 wrap"><button type="button" className="button" disabled={busy || !editable || !service?.credential.supported || !key.trim()} onClick={() => { const submitted = key.trim(); setKey(''); void run(async () => { await api('/settings/providers/local-qwen/credential', 'PUT', { apiKey: submitted }); await refresh(); notify('本机服务密钥已加密保存'); }); }}>保存可选密钥</button><button type="button" className="text-button" disabled={busy || !editable || !service?.credential.configured} onClick={() => void run(async () => { await api('/settings/providers/local-qwen/credential', 'DELETE'); await refresh(); notify('本机服务密钥已移除，连接设置保留'); })}>删除本机服务密钥</button></div>
    {service?.credential.configured && <p className="small-note">已加密保存 · 末尾 {service.credential.suffix}</p>}
    {service?.credential.problem && <p className="error-text" role="alert">{service.credential.problem}</p>}
    <button type="button" className="button" disabled={busy || !editable || dirty || !service?.configured} onClick={() => void run(async () => { await api('/settings/providers/local-qwen/credential/check', 'POST'); await refresh(); notify('本机模型列表已检查，未执行生成或下载'); })}>检查本机连接与模型</button>
    {service?.verification && <p role="status">{service.verification.models[0]?.model} · 已在本机列表中找到。{service.verification.note}</p>}
    <p className="muted">保存后在右侧模型分工或 Agent 中选择“本地 Qwen”。失败不会自动转用付费模型。云 API 预算记为 0，本机算力、电力及部署成本不包含在该估算内。服务端应禁用云端转发并仅监听回环地址。</p>
    <a className="text-button" href="https://docs.ollama.com/api/openai-compatibility" target="_blank" rel="noreferrer">Ollama 官方兼容接口说明 ↗</a><br/><a className="text-button" href="https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/" target="_blank" rel="noreferrer">vLLM 官方部署说明 ↗</a>
  </div>;
}
