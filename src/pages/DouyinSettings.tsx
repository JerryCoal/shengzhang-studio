import { useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, KeyRound, Link2, Monitor, RefreshCw } from 'lucide-react';
import { api, IS_WEB } from '../api';
import { useStudio } from '../context';
import { Field, Pill } from '../components';
import { hasDesktopAuthorization } from '../desktop';
import { webCallbackUrl } from '../web-connection';
import type { Integrations } from '../types';

const consoleUrl = 'https://developer.open-douyin.com/console';
const oauthDoc = 'https://open.douyin.com/platform/resource/docs/develop/permission/web/oauth2';
const permissions = [
  ['video.create', '上传与投稿视频'], ['video.data', '核对作品与公开状态'],
  ['item.comment', '读取自己公开作品的评论'], ['video.list', '从账号作品列表选择（选用）'],
];
export function DouyinSetupGuide() {
  return <div className="douyin-guide-body">
    <p><b>抖音账号与开放平台应用是两回事。</b>普通抖音账号用于发布作品；开放平台应用提供接口权限。当前版本需要填写你自己或所属机构管理的应用凭证，不内置可供所有人共用的应用密钥。</p>
    <ol className="douyin-steps">
      <li><b>注册开发者，创建移动 / 网站应用</b><p>打开官方控制台，按实际主体完成认证，创建适用的应用并按平台要求提交审核。桌面 OAuth 接入应使用平台支持的应用类型；不要把小程序的权限或凭证填到这里。</p><a href={consoleUrl} target="_blank" rel="noreferrer">打开抖音开放平台控制台 ↗</a></li>
      <li><b>核对接口权限是否已开通</b><p>进入应用详情的权限管理，查找视频发布、视频查询与评论管理能力。下面列出本工作台使用的权限；是否允许申请、是否需要审核或邀约，以你自己的控制台为准。如果找不到某权限，请通过平台支持渠道确认，不能仅凭登录账号获得。</p><div className="douyin-permission-list">{permissions.map(([scope, label]) => <div key={scope}><code>{scope}</code><span>{label}</span></div>)}</div></li>
      <li><b>登记授权回调地址</b><p>在应用的开发设置中登记回调域名 / 地址，再把对应完整地址填在下方。HTTPS 回调地址必须属于你管理且已在平台登记的应用。不能随便填抖音首页或陌生网站。平台若不接受 localhost，就必须使用可登记的 HTTPS 地址。</p><p>桌面版会在内置窗口中接收回调并返回工作台；这仍需要平台认可回调地址。网页版使用当前网站的回调地址。外部浏览器授权后，可复制完整回调网址回来完成连接。</p></li>
      <li><b>保存应用凭证，再授权自己的账号</b><p>从应用信息复制 Client Key 与 Client Secret，填入下方。它们不是抖音登录密码。桌面版保存在本机当前工作区的加密凭证库；{IS_WEB ? '网页版加密保存在本浏览器，接口调用时交给已配置的后端临时使用。' : '平台请求由本地后台执行。'}不要把这些信息发到聊天、截图或公开仓库。</p><p>选择所需功能，点击“连接抖音账号”。在抖音官方页面扫码或按页面提供的方式登录，核对授权账号与权限后确认。工作台不收集抖音密码。</p></li>
      <li><b>检查授权结果，安排一条视频</b><p>下方会分别显示能否发布、能否读取评论。到“发布中心”选择已完成的视频，保存计划，再点击“启用抖音自动发布”，核对成品、文案、账号和时间。可同时勾选审核通过后自动同步评论。上传成功与平台公开发布是不同阶段，以平台确认结果为准。</p></li>
      <li><b>持续运行与停止</b><p>桌面版关闭主窗口会保留托盘后台；退出登录、完全退出、电脑休眠或断网会影响任务。网页版需保持原工作区打开且联网。评论页可暂停同步、手动刷新并查看原文；删除本机凭证会停止后续任务，平台侧授权可在抖音的账号与安全设置中另行撤销。</p></li>
    </ol>
    <details><summary>常见问题：授权失败、缺少权限、没有评论</summary><ul>
      <li>提示重定向地址非法：核对当前应用、回调域名和完整地址，不要添加额外查询参数。</li>
      <li>提示作用域无权限：先在开放平台确认权限已开通；也可先选择“仅发布”或“仅评论”连接已具备的能力。</li>
      <li>应用内二维码不加载：点击浏览器授权链接。授权后的网址包含一次性 code，请在 15 分钟内粘贴回工作台，不要转发。</li>
      <li>作品一直待确认：可能仍在审核、不是公开作品，或查询暂未返回。先在抖音核对，再查询状态；不要重复投稿。</li>
      <li>获取不到评论：确认授权的是作品所属账号、作品公开、拥有 item.comment 权限，并且关联的是平台 item_id，不是直接把分享链接中的数字当作 item_id。</li>
      <li>自动同步暂停：查看错误说明，检查网络、配额或重新授权。同步只覆盖官方接口可见的一级评论，暂不获取楼中楼回复。</li>
    </ul></details>
    <p className="small-note">官方资料核对：2026-10-03。平台权限开放范围和审核结果以当时控制台为准。</p>
    <div className="row gap-12 wrap"><a href={oauthDoc} target="_blank" rel="noreferrer">官方授权说明 ↗</a><a href="https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/create-video" target="_blank" rel="noreferrer">视频投稿接口 ↗</a><a href="https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list" target="_blank" rel="noreferrer">评论接口 ↗</a></div>
  </div>;
}
export function DouyinSettings({ value, changed, onDelete }: { value: Integrations; changed: () => Promise<void>; onDelete: () => void }) {
  const { run, busy, notify, state, go } = useStudio();
  const [clientKey, setClientKey] = useState(''), [clientSecret, setClientSecret] = useState(''), [redirect, setRedirect] = useState(webCallbackUrl);
  const [authorizeUrl, setAuthorizeUrl] = useState(''), [callback, setCallback] = useState(''), [message, setMessage] = useState('');
  const [purpose, setPurpose] = useState('all'), [includeVideoList, setIncludeVideoList] = useState(false), [waiting, setWaiting] = useState(false);
  const mounted = useRef(true), attempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attempt.current++; void window.studioDesktop?.cancelDouyinAuthorization(); }; }, []);
  useEffect(() => { if (value.douyin.redirectUri) setRedirect(value.douyin.redirectUri); }, [value.douyin.redirectUri]);
  const editable = value.local && value.douyin.supported, accounts = state.accounts.filter(a => a.platform === 'douyin');
  const complete = (callbackUrl: string) => run(async () => {
    setCallback('');
    await api('/integrations/douyin/complete', 'POST', { callbackUrl });
    if (!mounted.current) return;
    setAuthorizeUrl(''); setMessage('账号连接完成。请核对下面的发布与评论权限。');
    await changed(); notify('抖音账号已连接，授权凭证已加密保存');
  });
  const openNative = async (url: string) => {
    const ticket = ++attempt.current;
    setWaiting(true); setMessage('请在应用内的抖音官方窗口完成登录与授权。');
    try {
      const result = await window.studioDesktop!.openDouyinAuthorization(url);
      if (!mounted.current || ticket !== attempt.current) return;
      setWaiting(false);
      if (result.callbackUrl) { setCallback(result.callbackUrl); setMessage('授权信息已返回，正在完成连接。如有其他操作占用，可在下方手动提交。'); await complete(result.callbackUrl); }
      else setMessage(result.error || '授权窗口已关闭。可重新打开或改用浏览器授权。');
    } catch { if (mounted.current && ticket === attempt.current) { setWaiting(false); setMessage('应用内授权未完成，请使用下方的官方链接。'); } }
  };
  const prepare = (accountId: string) => run(async () => {
    const result = await api<{ url: string }>('/integrations/douyin/authorize', 'POST', { accountId, purpose, includeVideoList });
    setAuthorizeUrl(result.url); setCallback('');
    if (hasDesktopAuthorization()) void openNative(result.url);
    else setMessage('点击下方官方授权链接，完成登录后回到这里粘贴回调网址。');
  });
  return <article className="service-card douyin-service" id="douyin-settings">
    <div className="service-title"><Link2 size={21}/><h3>抖音发布与评论</h3><Pill color={value.douyin.accounts.length ? 'green' : 'gray'}>{value.douyin.accounts.length ? '已连接 · 请核对权限' : value.douyin.configured ? '下一步：授权账号' : '从开通指引开始'}</Pill></div>
    <p>连接官方账号 → 核对视频并自动投稿 → 等待平台确认 → 自动带回评论。</p>
    <details className="douyin-guide" open={!value.douyin.configured}><summary><BookOpen size={17}/>第一次使用？查看完整开通与操作指引</summary><DouyinSetupGuide/></details>
    <form autoComplete="off" onSubmit={e => { e.preventDefault(); const submitted = { clientKey, clientSecret, redirectUri: redirect }; void run(async () => { await api('/integrations/douyin', 'PUT', submitted); setClientKey(''); setClientSecret(''); setAuthorizeUrl(''); setCallback(''); setMessage('应用凭证已保存，请继续连接下方抖音账号。'); await changed(); }); }}>
      <h4>1. 保存开放平台应用</h4>
      <Field label="Client Key（应用标识）" hint={value.douyin.configured ? `已保存 · 末尾 ${value.douyin.clientKeySuffix}。替换会使已有账号需要重新授权。` : '从官方控制台的应用信息中复制。'}><input required autoComplete="off" disabled={!editable || busy || waiting} value={clientKey} onChange={e => setClientKey(e.target.value)} maxLength={512}/></Field>
      <Field label="Client Secret（应用密钥）" hint="不是抖音密码；不会显示在项目备份中。"><input required type="password" autoComplete="off" disabled={!editable || busy || waiting} value={clientSecret} onChange={e => setClientSecret(e.target.value)} maxLength={512}/></Field>
      <Field label="平台注册的完整回调地址" hint="必须与自己的开放平台配置匹配；平台不接受本地地址时，需登记自己的 HTTPS 回调。"><input type="url" required disabled={!editable || busy || waiting} value={redirect} onChange={e => setRedirect(e.target.value)} maxLength={2048}/></Field>
      <div className="row gap-10 wrap"><button className="button primary" disabled={!editable || busy || waiting || !clientKey.trim() || !clientSecret.trim()}><KeyRound size={16}/>{value.douyin.configured ? '替换应用并重新授权' : '加密保存应用凭证'}</button><a className="button" href={consoleUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开官方控制台</a></div>
    </form>
    <div className="authorization-step"><h4>2. 连接自己的抖音账号</h4>
      <div className="service-fields"><Field label="这次需要的功能"><select value={purpose} disabled={busy || waiting} onChange={e => setPurpose(e.target.value)}><option value="all">发布视频与读取评论</option><option value="publish">仅发布视频</option><option value="comments">仅关联作品与读取评论</option></select></Field><label className="checkbox-row douyin-list-option"><input type="checkbox" checked={includeVideoList} disabled={busy || waiting} onChange={e => setIncludeVideoList(e.target.checked)}/><span>同时授权作品列表<br/><small>需已开通 video.list，便于选择已有作品</small></span></label></div>
      {accounts.map(account => {
        const connection = value.douyin.accounts.find(a => a.id === account.id);
        const valid = connection && connection.refreshExpiresAt > Date.now();
        const canPublish = valid && ['video.create', 'video.data'].every(s => connection.scopes.includes(s));
        const canComment = valid && connection.scopes.includes('item.comment');
        return <div className="authorized-account" key={account.id}><div><b>{account.name}</b><div className="douyin-account-capabilities"><Pill color={canPublish ? 'green' : 'gray'}>{canPublish ? '可自动投稿' : '发布权限待开通 / 授权'}</Pill><Pill color={canComment ? 'green' : 'gray'}>{canComment ? '可同步评论' : '评论权限待开通 / 授权'}</Pill></div>{connection ? <small>当前授权：{connection.scopes.join('、')}<br/>可续期至 {new Date(connection.refreshExpiresAt).toLocaleString('zh-CN')}；过期需重新登录授权。</small> : <small>此处名称是工作台账号标签，请在官方授权页核对实际登录账号。</small>}</div><button className="button small" disabled={!editable || busy || waiting || !value.douyin.configured} onClick={() => void prepare(account.id)}><Link2 size={14}/>{connection ? '重新连接' : '连接抖音账号'}</button></div>;
      })}
      {!accounts.length && <p>请先在账号管理中添加一个抖音账号标签，然后回来授权。</p>}
      {message && <p className="info-box" role="status">{message}</p>}
      {authorizeUrl && <div className="oauth-complete">
        <div className="row gap-10 wrap">{hasDesktopAuthorization() && <button className="button" disabled={waiting || busy} onClick={() => void openNative(authorizeUrl)}><Monitor size={15}/>在应用内打开授权</button>}<a className="button" href={authorizeUrl} target="_blank" rel="noreferrer" onClick={() => { attempt.current++; setWaiting(false); void window.studioDesktop?.cancelDouyinAuthorization(); }}><ExternalLink size={15}/>改用浏览器登录抖音</a></div>
        <details open={!!callback || undefined}><summary>浏览器授权后，手动完成连接</summary><Field label="授权后的完整回调网址" hint="复制浏览器地址栏的完整网址，15 分钟内提交；网址含一次性授权码，不要转发。"><input type="password" autoComplete="off" value={callback} disabled={waiting || busy} onChange={e => setCallback(e.target.value)} maxLength={8192}/></Field><button className="button primary" disabled={waiting || busy || !callback.trim()} onClick={() => void complete(callback.trim())}>完成账号连接</button></details>
      </div>}
    </div>
    <div className="douyin-next"><b>3. 开始发布与收集反馈</b><p>制作完成后去发布中心检查并启用自动投稿；也可以关联账号中已有的公开作品，再到评论页开启定时同步。</p><div className="row gap-10 wrap"><button className="button small" onClick={() => go('publish')}>前往发布中心</button><button className="button small" onClick={() => go('comments')}>查看评论同步</button><button className="button small" disabled={busy || waiting} onClick={() => void run(changed)}><RefreshCw size={14}/>刷新授权状态</button></div></div>
    {value.douyin.configured && <button className="text-button muted" disabled={!editable || busy || waiting} onClick={onDelete}>删除本机应用凭证并停止自动任务</button>}
  </article>;
}
