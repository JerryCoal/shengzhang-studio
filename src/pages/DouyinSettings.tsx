import { useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, KeyRound, Link2, Monitor, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useStudio } from '../context';
import { Field, Pill } from '../components';
import { hasDesktopAuthorization } from '../desktop';
import { webCallbackUrl } from '../web-connection';
import type { Integrations } from '../types';

const consoleUrl = 'https://developer.open-douyin.com/console';
const oauthDoc = 'https://open.douyin.com/platform/resource/docs/develop/permission/web/oauth2';
export function DouyinSetupGuide() {
  return <div className="douyin-guide-body">
    <p><b>发布内容无需配置这里。</b>抖音和小红书统一导出后手动发布。这里仅供已有开放平台权限的用户连接评论查询。</p>
    <ol className="douyin-steps">
      <li><b>先核对申请资格与权限</b><p>个人开发者目前只能创建小程序、小游戏和小玩法，不能把其凭证用于这里。企业身份可创建移动 / 网站应用，但不保证获得作品查询和评论读取权限。旧版接口文档仍可访问，新应用能否申请请先咨询官方，勿仅为本功能办理认证。</p><a href="https://developer.open-douyin.com/docs/resource/zh-CN/developer/join/issues" target="_blank" rel="noreferrer">查看官方入驻说明 ↗</a></li>
      <li><b>已有权限时再填写应用</b><p>需 video.data（核对自有作品）、item.comment（读取一级评论）；video.list 仅在选择账号作品列表时需要。本版不申请 video.create，也不支持自动上传或投稿。</p><a href={consoleUrl} target="_blank" rel="noreferrer">打开官方控制台 ↗</a></li>
      <li><b>配置自己的授权回调地址</b><p>回调须与开放平台登记的域名 / 地址匹配。HTTPS 地址应属于你管理的应用；只有平台允许本地调试时才使用 localhost。桌面版优先应用内授权，无法完成时使用浏览器链接。</p></li>
      <li><b>保存凭证并登录官方授权页</b><p>Client Key / Secret 是应用凭证，不是抖音登录密码。桌面版按工作区加密保存在本机；网页版加密保存在本浏览器，请求时临时交给已配置后端。登录密码只在抖音官方页面填写。</p></li>
      <li><b>手动发布，再关联作品</b><p>先在官方平台发布，回工作台登记作品链接。已获查询权限时，可以关联同一账号的已公开作品；开放平台 item_id 不一定等于分享链接里的数字。没有权限时直接导入评论文本。</p></li>
      <li><b>按需同步评论</b><p>到评论页点击立即同步，或单独开启定时同步。桌面版需电脑联网、唤醒且工作区已登录；网页版需保持页面打开。仅同步接口可见的一级评论，不发布、不回复评论。</p></li>
    </ol>
    <details><summary>授权失败或没有评论怎么办</summary><ul><li>缺少权限：在控制台核对 video.data、item.comment 是否确实获批；企业认证并不等于接口授权。</li><li>回调非法：核对应用登记的完整地址，不能填写任意网站。</li><li>应用内登录失败：使用下方浏览器链接；完成后 15 分钟内粘贴完整回调地址。地址含一次性授权码，不要转发。</li><li>查不到评论：核对账号、作品公开状态、完整 item_id；无法开通时使用手动导入。</li></ul></details>
    <p className="small-note">当前尚未使用获批的真实抖音应用完成评论联调，是否可用以官方权限和实际返回为准。</p>
    <div className="row gap-12 wrap"><a href={oauthDoc} target="_blank" rel="noreferrer">官方授权说明 ↗</a><a href="https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list" target="_blank" rel="noreferrer">评论接口说明 ↗</a></div>
  </div>;
}
export function DouyinSettings({ value, changed, onDelete }: { value: Integrations; changed: () => Promise<void>; onDelete: () => void }) {
  const { run, busy, notify, state, go } = useStudio();
  const [clientKey, setClientKey] = useState(''), [clientSecret, setClientSecret] = useState(''), [redirect, setRedirect] = useState(webCallbackUrl);
  const [authorizeUrl, setAuthorizeUrl] = useState(''), [callback, setCallback] = useState(''), [message, setMessage] = useState('');
  const [includeVideoList, setIncludeVideoList] = useState(false), [waiting, setWaiting] = useState(false);
  const mounted = useRef(true), attempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attempt.current++; void window.studioDesktop?.cancelDouyinAuthorization(); }; }, []);
  useEffect(() => { if (value.douyin.redirectUri) setRedirect(value.douyin.redirectUri); }, [value.douyin.redirectUri]);
  const editable = value.local && value.douyin.supported, accounts = state.accounts.filter(a => a.platform === 'douyin');
  const complete = (callbackUrl: string) => run(async () => {
    setCallback('');
    await api('/integrations/douyin/complete', 'POST', { callbackUrl });
    if (!mounted.current) return;
    setAuthorizeUrl(''); setMessage('账号连接完成。请核对下面的评论权限。');
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
    const result = await api<{ url: string }>('/integrations/douyin/authorize', 'POST', { accountId, purpose: 'comments', includeVideoList });
    setAuthorizeUrl(result.url); setCallback('');
    if (hasDesktopAuthorization()) void openNative(result.url);
    else setMessage('点击下方官方授权链接，完成登录后回到这里粘贴回调网址。');
  });
  return <article className="service-card douyin-service" id="douyin-settings">
    <div className="service-title"><Link2 size={21}/><h3>抖音评论接口 · 可选</h3><Pill color={value.douyin.accounts.length ? 'green' : 'gray'}>{value.douyin.accounts.length ? '已连接 · 请核对权限' : value.douyin.configured ? '下一步：授权账号' : '从开通指引开始'}</Pill></div>
    <p>手动发布无需配置。仅当你已有接口权限、需要同步评论时，才配置下面的连接。</p>
    <details className="douyin-guide" open={!value.douyin.configured}><summary><BookOpen size={17}/>第一次使用？查看完整开通与操作指引</summary><DouyinSetupGuide/></details>
    <form autoComplete="off" onSubmit={e => { e.preventDefault(); const submitted = { clientKey, clientSecret, redirectUri: redirect }; void run(async () => { await api('/integrations/douyin', 'PUT', submitted); setClientKey(''); setClientSecret(''); setAuthorizeUrl(''); setCallback(''); setMessage('应用凭证已保存，请继续连接下方抖音账号。'); await changed(); }); }}>
      <h4>1. 保存开放平台应用</h4>
      <Field label="Client Key（应用标识）" hint={value.douyin.configured ? `已保存 · 末尾 ${value.douyin.clientKeySuffix}。替换会使已有账号需要重新授权。` : '从官方控制台的应用信息中复制。'}><input required autoComplete="off" disabled={!editable || busy || waiting} value={clientKey} onChange={e => setClientKey(e.target.value)} maxLength={512}/></Field>
      <Field label="Client Secret（应用密钥）" hint="不是抖音密码；不会显示在项目备份中。"><input required type="password" autoComplete="off" disabled={!editable || busy || waiting} value={clientSecret} onChange={e => setClientSecret(e.target.value)} maxLength={512}/></Field>
      <Field label="平台注册的完整回调地址" hint="必须与自己的开放平台配置匹配；平台不接受本地地址时，需登记自己的 HTTPS 回调。"><input type="url" required disabled={!editable || busy || waiting} value={redirect} onChange={e => setRedirect(e.target.value)} maxLength={2048}/></Field>
      <div className="row gap-10 wrap"><button className="button primary" disabled={!editable || busy || waiting || !clientKey.trim() || !clientSecret.trim()}><KeyRound size={16}/>{value.douyin.configured ? '替换应用并重新授权' : '加密保存应用凭证'}</button><a className="button" href={consoleUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开官方控制台</a></div>
    </form>
    <div className="authorization-step"><h4>2. 连接自己的抖音账号</h4>
      <div className="service-fields"><label className="checkbox-row douyin-list-option"><input type="checkbox" checked={includeVideoList} disabled={busy || waiting} onChange={e => setIncludeVideoList(e.target.checked)}/><span>同时授权作品列表<br/><small>需已开通 video.list，便于选择已有作品</small></span></label></div>
      {accounts.map(account => {
        const connection = value.douyin.accounts.find(a => a.id === account.id);
        const valid = connection && connection.refreshExpiresAt > Date.now();
        const canComment = valid && connection.scopes.includes('item.comment');
        return <div className="authorized-account" key={account.id}><div><b>{account.name}</b><div className="douyin-account-capabilities"><Pill color="green">手动发布 · 无需授权</Pill><Pill color={canComment ? 'green' : 'gray'}>{canComment ? '可同步评论' : '评论权限待开通 / 授权'}</Pill></div>{connection ? <small>当前授权：{connection.scopes.join('、')}<br/>可续期至 {new Date(connection.refreshExpiresAt).toLocaleString('zh-CN')}；过期需重新登录授权。</small> : <small>此处名称是工作台账号标签，请在官方授权页核对实际登录账号。</small>}</div><button className="button small" disabled={!editable || busy || waiting || !value.douyin.configured} onClick={() => void prepare(account.id)}><Link2 size={14}/>{connection ? '重新连接' : '连接抖音账号'}</button></div>;
      })}
      {!accounts.length && <p>请先在账号管理中添加一个抖音账号标签，然后回来授权。</p>}
      {message && <p className="info-box" role="status">{message}</p>}
      {authorizeUrl && <div className="oauth-complete">
        <div className="row gap-10 wrap">{hasDesktopAuthorization() && <button className="button" disabled={waiting || busy} onClick={() => void openNative(authorizeUrl)}><Monitor size={15}/>在应用内打开授权</button>}<a className="button" href={authorizeUrl} target="_blank" rel="noreferrer" onClick={() => { attempt.current++; setWaiting(false); void window.studioDesktop?.cancelDouyinAuthorization(); }}><ExternalLink size={15}/>改用浏览器登录抖音</a></div>
        <details open={!!callback || undefined}><summary>浏览器授权后，手动完成连接</summary><Field label="授权后的完整回调网址" hint="复制浏览器地址栏的完整网址，15 分钟内提交；网址含一次性授权码，不要转发。"><input type="password" autoComplete="off" value={callback} disabled={waiting || busy} onChange={e => setCallback(e.target.value)} maxLength={8192}/></Field><button className="button primary" disabled={waiting || busy || !callback.trim()} onClick={() => void complete(callback.trim())}>完成账号连接</button></details>
      </div>}
    </div>
    <div className="douyin-next"><b>3. 手动发布后收集反馈</b><p>制作完成后到发布中心导出，在平台手动发布并回填链接。具备评论权限时关联公开作品，再选择是否定时同步。</p><div className="row gap-10 wrap"><button className="button small" onClick={() => go('publish')}>前往发布中心</button><button className="button small" onClick={() => go('comments')}>查看评论同步</button><button className="button small" disabled={busy || waiting} onClick={() => void run(changed)}><RefreshCw size={14}/>刷新授权状态</button></div></div>
    {value.douyin.configured && <button className="text-button muted" disabled={!editable || busy || waiting} onClick={onDelete}>删除本机应用凭证并停止评论同步</button>}
  </article>;
}
