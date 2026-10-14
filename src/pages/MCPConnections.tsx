import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ExternalLink, Link2, QrCode, RefreshCw } from 'lucide-react';
import { api, LOCAL_DATA } from '../api';
import { Channel, Field, Pill } from '../components';
import { desktopSessionToken } from '../desktop';
import type { Platform } from '../types';
import '../mcp.css';

export type MCPConnection = { platform: Platform; mode: 'builtin' | 'external'; endpoint: string; tokenConfigured: boolean; editable: boolean; builtinAvailable: boolean; connected: boolean; checkedAt?: string; capabilities?: { image: boolean; video: boolean; comments: boolean; login: boolean; loginStatus?: boolean }; toolCount?: number };
const platformNames: Record<Platform, string> = { xiaohongshu: '小红书', douyin: '抖音' };
const externalGuides = {
  xiaohongshu: { endpoint: 'http://127.0.0.1:18060/mcp', name: 'xpzouying/xiaohongshu-mcp', executable: 'xiaohongshu-mcp-windows-amd64.exe', url: 'https://github.com/xpzouying/xiaohongshu-mcp#readme', download: 'https://github.com/xpzouying/xiaohongshu-mcp/releases' },
  douyin: { endpoint: 'http://127.0.0.1:18080/mcp', name: 'panwenda/douyin-publish-mcp', executable: 'douyin-publish-mcp.exe', url: 'https://github.com/panwenda/douyin-publish-mcp#readme', download: 'https://gitee.com/pan-wenda/douyin/releases' },
};

export function useMCPConnections() {
  const [connections, setConnections] = useState<MCPConnection[]>([]), [error, setError] = useState('');
  const reload = async () => { if (LOCAL_DATA) return; try { setConnections((await api<{ platforms: MCPConnection[] }>('/mcp/settings')).platforms); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '无法读取 MCP 设置'); } };
  useEffect(() => { void reload(); }, []);
  return { connections, error, reload };
}

function ConnectionCard({ value, reload }: { value: MCPConnection; reload: () => Promise<void> }) {
  const name = platformNames[value.platform], guide = externalGuides[value.platform];
  const defaultEndpoint = guide.endpoint;
  const canLaunchExternal = typeof window.studioDesktop?.startExternalMCP === 'function';
  const [mode, setMode] = useState(value.mode), [endpoint, setEndpoint] = useState(value.endpoint || defaultEndpoint), [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [qr, setQr] = useState('');
  const [login, setLogin] = useState('unknown'), [action, setAction] = useState('');
  const saved = useRef({ mode: value.mode, endpoint: value.endpoint || defaultEndpoint });
  useEffect(() => {
    const next = { mode: value.mode, endpoint: value.endpoint || defaultEndpoint };
    if ((saved.current.mode !== next.mode || saved.current.endpoint !== next.endpoint) && mode === saved.current.mode && endpoint === saved.current.endpoint && !key && !clearKey) {
      setMode(next.mode); setEndpoint(next.endpoint); setLogin('unknown'); setQr('');
    }
    saved.current = next;
  }, [value.mode, value.endpoint, defaultEndpoint, mode, endpoint, key, clearKey]);
  const changed = mode !== value.mode || mode === 'external' && endpoint.trim() !== (value.endpoint || defaultEndpoint) || !!key || clearKey;
  const connected = !changed && value.connected;
  const canCheck = !busy && !changed && (mode === 'external' || value.builtinAvailable);
  const resetFeedback = () => { setQr(''); setLogin('unknown'); setMessage(''); setFailed(false); };

  async function perform(nextAction: 'save' | 'check' | 'login' | 'status' | 'repair' | 'platform-login' | 'start-external' | 'stop-external') {
    if (busy) return;
    setBusy(true); setAction(nextAction); setMessage(''); setFailed(false);
    let settingsSaved = false;
    if (nextAction !== 'save') setLogin('unknown'); if (nextAction !== 'status') setQr('');
    try {
      if (nextAction === 'save') {
        const submitted = key;
        await api(`/mcp/${value.platform}`, 'PUT', { mode, ...(mode === 'external' ? { endpoint: endpoint.trim(), ...(submitted ? { apiKey: submitted } : {}), clearKey } : {}) });
        settingsSaved = true;
        setKey(''); setClearKey(false); setEndpoint(endpoint.trim()); setLogin('unknown');
        await api(`/mcp/${value.platform}/check`, 'POST');
        setMessage(mode === 'builtin' ? '设置已保存，页面助手已连接。下一步打开官方登录窗口。' : '设置已保存，独立服务已连接。下一步完成平台扫码登录。');
      }
      if (nextAction === 'check') {
        await api(`/mcp/${value.platform}/check`, 'POST');
        setMessage(mode === 'builtin' ? '页面助手已连接。下一步到评论与复盘或发布中心，在打开的平台窗口中完成登录。' : '服务已连接。下一步检查平台登录状态；服务连通不代表平台账号已登录。');
      }
      if (nextAction === 'login') {
        const result = await api<{ image?: string; note: string; loginState?: string }>(`/mcp/${value.platform}/login`, 'POST');
        setQr(result.image || ''); setLogin(result.loginState || 'unknown'); setMessage(result.note);
      }
      if (nextAction === 'status') {
        const result = await api<{ loginState: string; note: string }>(`/mcp/${value.platform}/login-status`, 'POST');
        setLogin(result.loginState); if (result.loginState === 'logged-in') setQr(''); setMessage(result.note);
      }
      if (nextAction === 'repair') {
        const result = await window.studioDesktop!.restartMCP();
        if (result.error || !result.ok) throw new Error(result.error || '助手未能重新启动，请退出应用后重试。');
        await api(`/mcp/${value.platform}/check`, 'POST');
        setMessage('自带页面助手已重新启动，并通过连接检查。现在可以打开平台登录窗口。');
      }
      if (nextAction === 'platform-login') {
        const result = await window.studioDesktop!.openPlatformLogin({ platform: value.platform, sessionToken: desktopSessionToken() });
        if (result.error) throw new Error(result.error);
        setMessage(result.note || '平台窗口已关闭。请确认你已在窗口中完成登录；工作台不会据此推断登录成功。');
      }
      if (nextAction === 'start-external') {
        const result = await window.studioDesktop!.startExternalMCP({ platform: value.platform, sessionToken: desktopSessionToken() });
        if (result.cancelled) { setMessage('已取消选择程序，连接设置没有修改。'); return; }
        if (result.error) throw new Error(result.error);
        if (!result.endpoint) throw new Error('未获得可用的本机服务地址，请检查所选程序。');
        await api(`/mcp/${value.platform}`, 'PUT', { mode: 'external', endpoint: result.endpoint, apiKey: result.token || '', clearKey: !result.token });
        setMode('external'); setEndpoint(result.endpoint); setKey(''); setClearKey(false);
        if (result.ready === false) { setMessage('程序已启动，仍在准备本机服务。连接地址已保存，请稍候点击“检查服务连接”；首次登录还可能需要下载配套浏览器。'); return; }
        await api(`/mcp/${value.platform}/check`, 'POST');
        setMessage('独立 MCP 已启动并连接，地址已保存。下一步完成平台扫码登录；启动服务不会发布内容。');
      }
      if (nextAction === 'stop-external') {
        const result = await window.studioDesktop!.stopExternalMCP({ platform: value.platform, sessionToken: desktopSessionToken() });
        if (result.error) throw new Error(result.error);
        if (value.mode === 'external' && value.endpoint) await api(`/mcp/${value.platform}`, 'PUT', { mode: 'external', endpoint: value.endpoint });
        setMessage(result.note || '已停止工作台启动的服务，保存的连接设置仍保留。');
      }
    } catch (e) { setFailed(true); setMessage(`${settingsSaved ? '设置已保存，但服务尚未连接。' : ''}${e instanceof Error ? e.message : '操作未完成'}`); }
    finally { await reload(); setBusy(false); }
  }

  return <article className="mcp-card" aria-label={`${name}连接设置`}>
    <div className="mcp-card-heading"><Channel platform={value.platform}/><Pill color={connected ? 'green' : 'gray'}>{changed ? '有未保存修改' : connected ? '服务已连接' : '尚未连接'}</Pill></div>
    <Field label="使用哪种连接方式？"><select value={mode} disabled={busy} onChange={e => { setMode(e.target.value as typeof mode); resetFeedback(); }}><option value="builtin">自带页面助手 · 随 Windows 应用启动</option>{guide && <option value="external">独立 MCP 服务 · 下载后由工作台启动</option>}</select></Field>
    {mode === 'builtin' && <ol className="mcp-setup-steps">
      <li className={connected ? 'complete' : 'current'}><span>{connected ? <Check size={14}/> : '1'}</span><div><b>先启动服务</b><small>{mode === 'builtin' ? '运行 Windows 应用，再检查连接' : '运行独立服务，再保存地址并检查'}</small></div></li>
      <li className={connected && login === 'logged-in' ? 'complete' : connected ? 'current' : ''}><span>{connected && login === 'logged-in' ? <Check size={14}/> : '2'}</span><div><b>登录平台账号</b><small>{mode === 'builtin' ? '在采集或发布窗口中登录' : '使用该 MCP 自己的登录会话'}</small></div></li>
      <li><span>3</span><div><b>选择作品，核对结果</b><small>评论先预览导入，发布需单独确认</small></div></li>
    </ol>}
    {mode === 'builtin' ? <div className={`mcp-start-note ${value.builtinAvailable ? '' : 'needs-action'}`}>
      <b>{value.builtinAvailable ? '本次已检测到 Windows 页面助手' : '当前没有检测到 Windows 页面助手'}</b>
      <p>{value.builtinAvailable ? '无需填写地址和密钥。点击下方检查连接；首次采集或发布时，再在平台窗口内登录。' : '请解压最新版 Windows 安装包，双击 ShengzhangStudio.exe。只打开网站、预览页或旧的本地网址，不能启动这个助手。'}</p>
    </div> : <>
      <div className="mcp-start-note mcp-quick-start"><b>下载一次，从工作台启动</b><p>工作台会自动填写地址、保存连接并检查服务，无需输入命令。</p><ol>
        <li><strong>下载并解压</strong><a href={guide.download} target="_blank" rel="noreferrer">打开{name} MCP 项目发布页 <ExternalLink size={13}/></a><small>选择 Windows 版本，主程序名为 <code>{guide.executable}</code>。{value.platform === 'xiaohongshu' ? '不要选择文件名含 login 的登录工具。' : '如果下载的是整包，请保留解压后的配套文件。'}</small></li>
        <li><strong>选择主程序</strong>{canLaunchExternal ? <button className="button primary small" disabled={busy || !value.editable} onClick={() => void perform('start-external')}>选择程序并启动</button> : <p>请在 Windows 桌面版中使用“选择程序并启动”；已自行启动的服务可用下方手动连接。</p>}<small>{value.platform === 'xiaohongshu' ? '首次运行可能由外部服务下载配套浏览器，请保持联网。' : '请先安装 Chrome。首次登录可能由外部服务下载配套浏览器驱动。'}程序仍在准备时，稍候检查连接即可。</small></li>
        <li><strong>扫码登录平台</strong><small>服务连接成功后，在下方完成扫码并检查登录。独立服务与自带页面助手分别登录；发布仍需你最后确认。</small></li>
      </ol></div>
      {value.platform === 'douyin' && <p className="mcp-capability-note">工作台目前通过此抖音独立 MCP 接入图文、视频发布与登录。抖音评论采集请使用“自带页面助手”。</p>}
      <details className="mcp-manual-connection" open={!canLaunchExternal || undefined}><summary>已自行启动服务？手动填写地址与令牌</summary>
      <Field label="独立服务的本机地址" hint="填写这台电脑上服务实际显示的 HTTP 地址。小红书与抖音不能共用同一个服务端口。"><input type="url" value={endpoint} placeholder={defaultEndpoint} disabled={busy} onChange={e => { setEndpoint(e.target.value); resetFeedback(); }} spellCheck={false}/></Field>
      <details className="mcp-token-details"><summary>MCP 访问令牌（通常留空）{value.tokenConfigured && ' · 已保存'}</summary>
        <Field label="仅在独立 MCP 要求鉴权时填写" hint={value.tokenConfigured ? '留空保留已加密保存的令牌。更换地址会清除旧令牌。' : '这里不填 Qwen / DeepSeek 等模型 API Key，也不填平台密码或 Cookie。'}><input type="password" autoComplete="off" value={key} disabled={busy} maxLength={2048} onChange={e => setKey(e.target.value)}/></Field>
        {value.tokenConfigured && <label className="checkbox-row"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)} disabled={busy}/>清除已保存的访问令牌</label>}
      </details>
      </details>
      {typeof window.studioDesktop?.stopExternalMCP === 'function' && <button className="text-button muted mcp-stop-service" disabled={busy} onClick={() => void perform('stop-external')}>停止工作台启动的服务</button>}
    </>}
    <div className="mcp-connection-actions"><button className="button small" disabled={busy || !changed || !value.editable} onClick={() => void perform('save')}>保存并检查连接</button><button className="button primary small" disabled={!canCheck} onClick={() => void perform('check')}><RefreshCw size={15}/>{connected ? '重新检查服务' : '检查服务连接'}</button></div>
    {mode === 'builtin' && <div className="mcp-connection-actions">{typeof window.studioDesktop?.restartMCP === 'function' && <button className="button small" disabled={busy || changed} onClick={() => void perform('repair')}>修复内置连接</button>}{typeof window.studioDesktop?.openPlatformLogin === 'function' && <button className="button small" disabled={busy || !connected} onClick={() => void perform('platform-login')}>打开官方登录窗口</button>}</div>}
    {changed && <p className="small-note">{mode === 'external' && canLaunchExternal ? '选择程序启动会自动保存；已运行的服务可直接“保存并检查连接”。' : '点击“保存并检查连接”应用本次修改。'}保存设置不会发布内容。</p>}
    {mode === 'external' && <div className="mcp-login-panel"><div><b>平台登录</b><span>{!connected ? '先连接服务' : login === 'logged-in' ? '最近检查：已登录' : login === 'not-logged-in' ? '尚未登录' : '尚未核对'}</span></div>
      <div className="mcp-connection-actions">{value.capabilities?.login && <button className="button small" disabled={busy || !connected} onClick={() => void perform('login')}><QrCode size={15}/>{value.platform === 'douyin' ? '打开扫码登录' : '获取登录二维码'}</button>}{value.capabilities?.loginStatus && <button className="button small" disabled={busy || !connected} onClick={() => void perform('status')}>{qr ? '我已扫码，检查登录' : '检查平台登录'}</button>}</div>
      {connected && !value.capabilities?.login && <p className="small-note">这个服务没有提供应用内二维码工具，请按它的安装说明在本机登录。工作台登录与平台登录是两件事。</p>}
    </div>}
    {busy && <p className="small-note" role="status">{action === 'save' ? '正在加密保存设置并检查服务连接…' : action === 'repair' ? '正在重新启动本机助手，并检查连接…' : action === 'start-external' ? '请在文件窗口中选择已下载的程序；首次启动可能需要准备配套浏览器。' : action === 'check' ? '正在检查本机服务和可用工具…' : action === 'platform-login' ? '请在官方窗口中登录，完成后关闭该窗口返回工作台。' : action === 'stop-external' ? '正在停止工作台启动的服务…' : '正在检查平台登录，请留意服务窗口…'}</p>}
    {message && <div className={`mcp-result ${failed ? 'failed' : ''}`} role={failed ? 'alert' : 'status'}><p>{message}</p>{failed && ['save', 'check', 'repair', 'start-external'].includes(action) && <small>{mode === 'builtin' ? '下一步：先尝试“修复内置连接”。仍失败时，从工作台菜单选择“退出并停止后台任务”，再打开最新版 ShengzhangStudio.exe；关闭窗口右上角 × 只会最小化到托盘。' : '下一步：首次启动请等待浏览器准备完成，再点“检查服务连接”。如果独立 MCP 已经退出，请重新启动；地址应与服务实际端口一致。浏览器打开 MCP 地址不一定会显示网页，请以此处检查结果为准。'}</small>}</div>}
    {qr && <div className="mcp-qr-block"><img className="mcp-qr" src={qr} alt={`${name} MCP 登录二维码`}/><p className="small-note">用{name} App 扫码后，点击“我已扫码，检查登录”。二维码过期时重新获取。</p></div>}
    {connected && value.capabilities && <div className="mcp-capabilities" aria-label="当前服务提供的能力">{[['图文发布', value.capabilities.image], ['视频发布', value.capabilities.video], ['评论读取', value.capabilities.comments]].map(([label, enabled]) => <span key={String(label)} className={enabled ? 'available' : ''}>{enabled ? '✓' : '—'} {label}</span>)}</div>}
    {connected && <div className="mcp-next-actions">{value.capabilities?.comments && <a href="#comments">去评论与复盘 <ArrowRight size={14}/></a>}{(value.capabilities?.image || value.capabilities?.video) && <a href="#publish">去发布中心 <ArrowRight size={14}/></a>}<p>{value.capabilities?.comments ? '先在发布中心登记自有作品链接，再选择“MCP 获取评论”。' : '当前独立服务不支持评论读取，可切换为自带页面助手。'}发布时会再次展示本次素材与确认选项。</p></div>}
    {mode === 'external' && <details className="mcp-help"><summary>为什么还需要单独下载？</summary><p>外部 MCP 可以集成到软件。当前已集成“选择程序、启动、保存地址、检查连接”；第三方服务本体仍需下载一次。它们独立运行、分别更新，也需要自己的浏览器环境和平台登录。</p><p>若随安装包一并提供，还需固定并验证版本、准备浏览器依赖及保留开源许可声明。当前版本没有打包这两个外部程序；日常发布和评论采集可先用自带页面助手。</p></details>}
    <details className="mcp-help"><summary>{mode === 'builtin' ? '仍然连不上？查看排查步骤' : '启动失败与常见问题'}</summary>{mode === 'builtin' ? <ol>
      <li>完整解压 Windows 版本，不要只复制其中的 exe，也不要在压缩包内运行。</li>
      <li>启动 <strong>ShengzhangStudio.exe</strong>，通过它打开的工作台登录；网页预览和静态体验版没有自带助手。</li>
      <li>先点“修复内置连接”；仍失败时，使用左上角“工作台 → 退出并停止后台任务”，再打开新版程序。旧版托盘进程可能仍在运行。</li>
      <li>检查连接成功后，打开官方登录窗口，或去评论与复盘、发布中心操作，无需申请开放平台账号。</li>
    </ol> : <><ol>
      <li>请选主程序 <code>{guide.executable}</code>，不是压缩包、快捷方式或登录工具。</li>
      <li>首次启动可能需要下载配套浏览器或驱动。程序仍在准备时，稍候点击“检查服务连接”，无需反复启动。</li>
      <li>提示端口占用时，先检查已有服务；要更换程序，先停止工作台启动的服务。自行启动的旧服务请在原窗口关闭。</li>
      <li>已自行启动的服务，展开“手动填写地址与令牌”，填入实际 HTTP 地址，再保存并检查。{name}默认使用 <code>{guide.endpoint}</code>。</li>
      <li>服务连通后，使用{name} App 扫码，再检查平台登录。服务已连接不代表平台已登录。</li>
      <li>退出工作台会停止由它启动的服务，下次使用需再次选择程序启动。登录是否仍有效，以检查结果为准。</li>
    </ol>{value.platform === 'douyin' && <p>抖音发布页来自该项目 README 指向的 Gitee 仓库。首次登录需要系统 Chrome 和配套驱动；使用 Edge 需按项目说明配置浏览器通道。</p>}<p>独立服务自行管理平台登录文件。通过此处启动时，工作台按用户分开服务目录；自行启动时，请为不同使用者使用各自的目录与端口。Docker 用户还需让服务能读取本机素材路径。</p><a href={guide.url} target="_blank" rel="noreferrer">{guide.name} 完整说明 ↗</a></>}</details>
  </article>;
}
export function MCPConnections() {
  const { connections, error, reload } = useMCPConnections();
  return <section className="panel mcp-settings"><div className="section-heading"><div><h2><Link2 size={19}/>平台连接与使用引导</h2><p className="muted">MCP 负责操作平台；Qwen、DeepSeek 等模型负责创作，模型密钥请在“文字模型”中设置。</p></div></div>
    <div className="mcp-intro"><b>第一次使用，建议先选“自带页面助手”</b><p>无需另外安装服务。先连接服务，再登录平台，最后选择作品采集评论或确认发布。需要小红书热点检索时，再配置独立的小红书 MCP。</p></div>
    {LOCAL_DATA ? <p className="info-box">本机 MCP 需要 Windows 应用或同机后端。静态网站及远程网站不能调用你的本机助手。</p> : error ? <p className="info-box" role="alert">{error}<button className="text-button" onClick={() => void reload()}>重新读取</button></p> : !connections.length ? <p className="small-note" role="status">正在读取连接设置…</p> : <div className="mcp-grid">{connections.map(value => <ConnectionCard key={value.platform} value={value} reload={reload}/>)}</div>}
  </section>;
}
