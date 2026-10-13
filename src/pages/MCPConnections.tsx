import { useEffect, useState } from 'react';
import { Check, Link2, QrCode } from 'lucide-react';
import { api, LOCAL_DATA } from '../api';
import { Channel, Field, Pill } from '../components';
import type { Platform } from '../types';
import '../mcp.css';

export type MCPConnection = { platform: Platform; mode: 'builtin' | 'external'; endpoint: string; tokenConfigured: boolean; editable: boolean; builtinAvailable: boolean; connected: boolean; checkedAt?: string; capabilities?: { image: boolean; video: boolean; comments: boolean; login: boolean }; toolCount?: number };
export function useMCPConnections() {
  const [connections, setConnections] = useState<MCPConnection[]>([]), [error, setError] = useState('');
  const reload = async () => { if (LOCAL_DATA) return; try { setConnections((await api<{ platforms: MCPConnection[] }>('/mcp/settings')).platforms); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '无法读取 MCP 设置'); } };
  useEffect(() => { void reload(); }, []);
  return { connections, error, reload };
}
function ConnectionCard({ value, reload }: { value: MCPConnection; reload: () => Promise<void> }) {
  const [mode, setMode] = useState(value.mode), [endpoint, setEndpoint] = useState(value.endpoint || 'http://127.0.0.1:18060/mcp'), [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [qr, setQr] = useState('');
  const changed = mode !== value.mode || mode === 'external' && endpoint !== value.endpoint || !!key || clearKey;
  async function perform(action: 'save' | 'check' | 'login') {
    setBusy(true); setMessage(''); setQr('');
    try {
      if (action === 'save') { const submitted = key; setKey(''); await api(`/mcp/${value.platform}`, 'PUT', { mode, ...(mode === 'external' ? { endpoint, ...(submitted ? { apiKey: submitted } : {}), clearKey } : {}) }); setClearKey(false); setMessage('连接设置已在本机加密保存，请检查连接。'); }
      if (action === 'check') { await api(`/mcp/${value.platform}/check`, 'POST'); setMessage('MCP 工具已检查。这不代表平台账号已登录，请在操作窗口核对账号。'); }
      if (action === 'login') { const result = await api<{ image: string; note: string }>(`/mcp/${value.platform}/login`, 'POST'); setQr(result.image); setMessage(result.note); }
      await reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : '操作未完成'); }
    finally { setBusy(false); }
  }
  return <article className="mcp-card">
    <div className="row between"><Channel platform={value.platform}/><Pill color={value.connected ? 'green' : 'gray'}>{value.connected ? '工具已连接' : '待检查'}</Pill></div>
    <Field label="连接方式"><select value={mode} disabled={busy} onChange={e => { setMode(e.target.value as typeof mode); setQr(''); }}><option value="builtin">内置 MCP · 官方页面助手</option>{value.platform === 'xiaohongshu' && <option value="external">外部 MCP · xpzouying/xiaohongshu-mcp</option>}</select></Field>
    {mode === 'builtin' ? <p className="muted">{value.builtinAvailable ? '已随 Windows 应用启动，无需额外安装。发布和评论窗口中完成官方登录；最终发布由你确认。' : '请运行 v1.7.0 Windows 应用以启动内置 MCP。本地开发网页版可连接外部小红书 MCP。'}</p> : <>
      <Field label="本机 MCP 地址" hint="填写同一台电脑运行的服务；Docker 用户须让服务能够读取宿主机素材路径。"><input type="url" value={endpoint} disabled={busy} onChange={e => setEndpoint(e.target.value)} spellCheck={false}/></Field>
      <Field label="MCP 访问令牌（可选）" hint={value.tokenConfigured ? '已加密保存；留空保留。更换地址会清除旧令牌。' : '该项目默认无需令牌。这里只填 MCP 访问令牌，不填模型 Key、平台密码或 Cookie。'}><input type="password" autoComplete="off" value={key} disabled={busy} maxLength={2048} onChange={e => setKey(e.target.value)}/></Field>
      {value.tokenConfigured && <label className="checkbox-row"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)} disabled={busy}/>清除已保存的访问令牌</label>}
      <details className="settings-details"><summary>首次安装与启动</summary><ol><li><a href="https://github.com/xpzouying/xiaohongshu-mcp/releases" target="_blank" rel="noreferrer">下载项目的 Windows 版本</a>并解压到自己的本地目录。</li><li>启动小红书 MCP 服务，保持程序运行。默认地址为 127.0.0.1:18060/mcp。</li><li>保存地址 → 检查连接 → 获取二维码，用小红书 App 扫码。</li><li>去发布中心选择“MCP 投送”，或去评论页选择“MCP 获取”。</li></ol><p>这是社区维护的服务，不是平台官方接口。平台登录文件由该服务管理，可能保存为本地 Cookie；工作台不读取或上传这些文件，不同工作台用户应使用各自的服务目录和端口。</p><a href="https://github.com/xpzouying/xiaohongshu-mcp#readme" target="_blank" rel="noreferrer">完整安装说明 ↗</a></details>
    </>}
    <div className="row gap-10 wrap"><button className="button small" disabled={busy || !changed || !value.editable} onClick={() => void perform('save')}>保存连接</button><button className="button primary small" disabled={busy || changed || mode === 'builtin' && !value.builtinAvailable} onClick={() => void perform('check')}><Check size={15}/>检查连接</button>{mode === 'external' && <button className="button small" disabled={busy || changed || !value.capabilities?.login} onClick={() => void perform('login')}><QrCode size={15}/>扫码登录</button>}</div>
    {value.capabilities && <div className="mcp-capabilities">{[['图文投送', value.capabilities.image], ['视频投送', value.capabilities.video], ['评论读取', value.capabilities.comments]].map(([label, enabled]) => <span key={String(label)} className={enabled ? 'available' : ''}>{enabled ? '✓' : '—'} {label}</span>)}</div>}
    {message && <p className="info-box" role="status">{message}</p>}{qr && <img className="mcp-qr" src={qr} alt="小红书 MCP 登录二维码"/>}
  </article>;
}
export function MCPConnections() {
  const { connections, error, reload } = useMCPConnections();
  return <section className="panel mcp-settings"><div className="section-heading"><div><h2><Link2 size={19}/>平台 MCP 连接</h2><p className="muted">连接平台操作工具，文字创作模型在“文字模型”中单独设置。</p></div></div>
    {LOCAL_DATA ? <p className="info-box">本机 MCP 需要 Windows 应用或同机后端。静态网站及远程网站不能调用你的本机助手。</p> : error ? <p className="info-box" role="alert">{error}<button className="text-button" onClick={() => void reload()}>重新读取</button></p> : <div className="mcp-grid">{connections.map(value => <ConnectionCard key={value.platform} value={value} reload={reload}/>)}</div>}
  </section>;
}
