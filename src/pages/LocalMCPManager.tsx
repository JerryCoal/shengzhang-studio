import { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Play, RefreshCw, Square } from 'lucide-react';
import { api } from '../api';
import { desktopSessionToken, type ExternalMCPStatus } from '../desktop';
import { LOCAL_MCP_CATALOG, localMCPDeploymentGuide } from '../../server/local-mcp-catalog.mjs';
import type { MCPConnection } from './MCPConnections';

const labels = { stopped: '已停止', starting: '正在准备', running: '本机端口就绪', failed: '启动未完成', stopping: '正在停止' };
type LaunchResult = { endpoint: string; token: string; ready: boolean };
export function LocalMCPManager({ value, team, reload }: { value: MCPConnection; team: boolean; reload: () => Promise<void> }) {
  const entry = LOCAL_MCP_CATALOG[value.platform], accountId = value.accountId || 'default';
  const supported = !team && entry.managed && typeof window !== 'undefined' && !!window.studioDesktop?.startExternalMCP;
  const [status, setStatus] = useState<ExternalMCPStatus | null>(null), [launch, setLaunch] = useState<LaunchResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(true);
  const args = () => ({ platform: value.platform as 'xiaohongshu' | 'douyin', accountId, sessionToken: desktopSessionToken() });
  const readStatus = async () => {
    if (!supported) return;
    const result = await window.studioDesktop!.getExternalMCPStatus(args());
    if (!active.current) return;
    if (result.error) throw new Error(result.error);
    setStatus(result.items?.[0] || null);
  };
  useEffect(() => {
    active.current = true;
    if (supported) void readStatus().catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : '本机状态读取失败'); });
    return () => { active.current = false; };
  }, [supported, accountId, value.platform]);
  useEffect(() => {
    if (!supported || !status?.managed) return;
    const timer = window.setInterval(() => { void readStatus().catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : '本机状态读取失败'); }); }, 4000);
    return () => window.clearInterval(timer);
  }, [supported, status?.managed]);
  async function perform(action: 'start' | 'choose' | 'stop' | 'refresh' | 'connect' | 'copy') {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'copy') { await navigator.clipboard.writeText(localMCPDeploymentGuide(value.platform)); if (active.current) setNotice('部署核对说明已复制；不含账号、密钥或自动执行命令。'); }
      else if (action === 'connect') {
        if (!launch) throw new Error('请先启动所选本地服务');
        await api(`/mcp/${value.platform}`, 'PUT', { accountId, mode: 'external', endpoint: launch.endpoint, apiKey: launch.token, clearKey: !launch.token });
        if (active.current) { setNotice('已将当前账号切到该本机连接。下一步在下方检查服务与平台登录；没有发起采集或发布。'); setLaunch(null); await reload(); }
      } else if (action === 'stop') {
        const result = await window.studioDesktop!.stopExternalMCP(args()); if (result.error) throw new Error(result.error);
        if (active.current) { setLaunch(null); setNotice(result.note || '已停止工作站启动的当前账号服务；账号登录文件未删除。'); }
      } else if (action !== 'refresh') {
        const result = await window.studioDesktop!.startExternalMCP({ ...args(), chooseProgram: action === 'choose' });
        if (!active.current) return;
        if (result.error) throw new Error(result.error);
        if (result.cancelled) { setNotice('已取消，本机连接设置没有修改。'); return; }
        if (!result.endpoint) throw new Error('服务没有返回可用的本机连接地址');
        setLaunch({ endpoint: result.endpoint, token: result.token || '', ready: result.ready === true });
        setNotice('已启动所选程序，现有手动连接尚未更换。确认后可将此本机服务连接到当前账号。平台登录仍需另行核对。');
      }
      if (action !== 'copy' && active.current) await readStatus();
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '本地服务操作未完成，请重试'); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="local-mcp-manager" aria-label="本地 MCP 管理"><div className="section-heading"><div><h3>本地 MCP 管理</h3><p className="small-note">{entry.name} · 当前连接账号：{value.accountName || '默认账号'}。本地启动和手动连接分别管理。</p></div><button className="button small" disabled={busy} onClick={() => void perform('copy')}><Copy size={14}/>复制给模型的部署说明</button></div>
    <p>{entry.requirement}</p><p className="small-note">适配来源：<a href={entry.url} target="_blank" rel="noreferrer">{entry.project} ↗</a>。不会自动下载安装，也不会接受任意命令。</p>
    {supported ? <><p role="status">本机状态：<b>{status ? labels[status.status] : '待读取'}</b>{status?.programSaved ? ' · 已保存当前账号程序' : ' · 尚未选择程序'}</p><p className="small-note">{status?.note}进程/端口就绪不等于平台已登录；本页不会自动调用平台工具。</p><div className="mcp-connection-actions"><button className="button primary small" disabled={busy || status?.managed || !value.editable} onClick={() => void perform('start')}><Play size={14}/>{status?.programSaved ? '启动已保存程序' : '选择本地程序并启动'}</button>{status?.programSaved && <button className="button small" disabled={busy || status.managed || !value.editable} onClick={() => void perform('choose')}><FolderOpen size={14}/>更换程序</button>}<button className="button small" disabled={busy || !status?.managed} onClick={() => void perform('stop')}><Square size={14}/>停止本账号服务</button><button className="text-button" disabled={busy} onClick={() => void perform('refresh')}><RefreshCw size={14}/>刷新本机状态</button></div>{launch && <div className="info-box"><p>待连接本机地址：{launch.endpoint}。{launch.ready ? '端口已就绪。' : '仍在准备，稍后检查连接。'}启用将替换当前账号保存的连接地址；不会停止您自行运行的服务。</p><button className="button small" disabled={busy || !value.editable} onClick={() => void perform('connect')}>确认将此本地服务用于当前账号</button></div>}</> : <p className="info-box">{team ? '团队网页不提供主机任意程序启动。请由管理员按部署说明在主机准备服务，再使用下方手动连接。' : entry.managed ? '此管理能力需要 Windows 桌面版；当前页面仍可手动连接已运行的本机服务。' : '此平台当前仅提供部署核对说明与手动连接，不声称已内置或支持一键启动。'}</p>}
    {error && <p className="mcp-result failed" role="alert">{error}</p>}{notice && <p className="mcp-result" role="status">{notice}</p>}
  </section>;
}
