import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Channel, Field, Modal } from '../components';
import { useStudio } from '../context';
import { useMCPConnections } from '../pages/MCPConnections';
import { openPublishingSettings } from '../pages/SettingsPage';
import { PLATFORM_NAMES, PUBLISH_LIMITS } from '../../server/platform-catalog.mjs';
import type { Asset, Publication } from '../types';

type TikTokOptions = { preflightId: string; creatorNickname: string; creatorUsername: string; privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoDurationSeconds: number | null; notice: string };
const privacyNames: Record<string,string> = { PUBLIC_TO_EVERYONE: '所有人可见', MUTUAL_FOLLOW_FRIENDS: '互关好友可见', FOLLOWER_OF_CREATOR: '关注者可见', SELF_ONLY: '仅自己可见' };

export function MCPPublishDialog({ content, onClose }: { content: Asset | Publication; onClose: () => void }) {
  const { project, state, mutate, refresh, go } = useStudio();
  const { connections, error } = useMCPConnections();
  const platform = 'channel' in content ? content.channel : content.platform, connection = connections.find(c => c.platform === platform), limits = PUBLISH_LIMITS[platform];
  const accounts = state.accounts.filter(a => a.platform === platform);
  const [accountId, setAccountId] = useState('accountId' in content ? content.accountId : accounts[0]?.id || '');
  const [recordId, setRecordId] = useState('accountId' in content ? content.id : '');
  const [title, setTitle] = useState(content.title), [body, setBody] = useState(content.body), [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const [publicMediaUrl,setPublicMediaUrl] = useState(''), [mediaConfirmed,setMediaConfirmed] = useState(false), [privacy,setPrivacy] = useState(platform === 'youtube' ? 'private' : '');
  const [tiktokOptions,setTikTokOptions] = useState<TikTokOptions|null>(null), [checking,setChecking] = useState(false), [durationSeconds,setDurationSeconds] = useState<number|null>(null);
  const [brandOrganic,setBrandOrganic] = useState(''), [brandContent,setBrandContent] = useState(''), [aiGenerated,setAiGenerated] = useState('');
  const [allowComments,setAllowComments] = useState(false), [allowDuet,setAllowDuet] = useState(false), [allowStitch,setAllowStitch] = useState(false);
  const [musicConfirmed,setMusicConfirmed] = useState(false), [brandedContentConfirmed,setBrandedContentConfirmed] = useState(false);
  const identity = `${connection?.accountId || ''}|${connection?.endpoint || ''}|${connection?.remoteAccount || ''}`, identityRef = useRef(identity);
  const fetching = useRef(false);
  useEffect(() => { identityRef.current = identity; setTikTokOptions(null); setConfirmed(false); setPrivacy(platform === 'youtube' ? 'private' : ''); setAllowComments(false); setAllowDuet(false); setAllowStitch(false); }, [identity, platform]);
  const record = project?.publications.find(r => r.id === recordId), locked = !!record?.delivery && record.delivery.phase !== 'reset';
  const associated = accounts.find(account=>account.id === accountId), accountMismatch = !!associated?.mcpAccountId && associated.mcpAccountId !== connection?.accountId;
  const image = content.mime.startsWith('image/'), video = content.mime.startsWith('video/'), needsURL = platform === 'instagram' || platform === 'tiktok';
  const supported = ['image/png','image/jpeg','video/mp4'].includes(content.mime) && (platform !== 'youtube' || video);
  const capabilityMissing = !!connection?.connected && (image ? connection.capabilities?.image === false : connection.capabilities?.video === false);
  const requiresConnectionCheck = ['tiktok', 'youtube', 'instagram'].includes(platform) && connection?.mode === 'external'
    && (!connection.connected || (image ? connection.capabilities?.image : connection.capabilities?.video) !== true);
  let validURL = false; try { const url = new URL(publicMediaUrl); validURL = url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.'); } catch { /* Display one concise requirement below. */ }
  const tiktokReady = platform !== 'tiktok' || !!tiktokOptions && tiktokOptions.privacyOptions.includes(privacy) && !!brandOrganic && !!brandContent && !!aiGenerated && musicConfirmed && (brandContent !== 'yes' || brandedContentConfirmed && privacy !== 'SELF_ONLY') && (image || durationSeconds !== null && tiktokOptions.maxVideoDurationSeconds !== null && durationSeconds <= tiktokOptions.maxVideoDurationSeconds);
  const valid = !!title.trim() && title.length <= limits.title && body.length <= limits.body && !!accountId && supported && !accountMismatch && !requiresConnectionCheck && (!needsURL || validURL && mediaConfirmed) && tiktokReady;
  const disabled = working || locked;
  function edited() { setConfirmed(false); }

  async function loadTikTokOptions() {
    if (!connection || working || fetching.current) return;
    fetching.current = true; setChecking(true); setMessage(''); setTikTokOptions(null); setPrivacy(''); edited();
    const requestedIdentity = identity;
    try {
      const options = await api<TikTokOptions>('/mcp/tiktok/publish-options','POST',{accountId:connection.accountId || 'default'});
      if (identityRef.current !== requestedIdentity) throw Error('连接账号已切换，请重新读取发布选项');
      setTikTokOptions(options); setAllowComments(false); setAllowDuet(false); setAllowStitch(false);
    } catch(e) { setMessage(e instanceof Error ? e.message : '未取得 TikTok 发布权限'); }
    finally { fetching.current = false; setChecking(false); }
  }
  async function submit() {
    if (!project || !confirmed || working || locked || !valid || !connection) return;
    setWorking(true); setMessage('');
    try {
      let targetId = recordId;
      if (!targetId && 'channel' in content) {
        const old = project.publications.find(r => r.assetId === content.id && r.assetRevision === content.revision && r.accountId === accountId && r.status !== 'cancelled');
        if (old?.status === 'published') throw Error('此版本已经登记发布，请查看已有记录');
        if (old?.delivery && old.delivery.phase !== 'reset') throw Error('这条内容已有提交记录，请先到发布中心核对结果');
        targetId = old?.id || (await mutate<Publication>(`/projects/${project.id}/publications`, 'POST', { assetId: content.id, accountId, scheduledAt: new Date().toISOString() })).result.id;
        setRecordId(targetId);
      }
      const response = await api<{ result: { note: string } }>(`/projects/${project.id}/publications/${targetId}/mcp/publish`, 'POST', {
        confirmed: true, expectedRevision: 'assetRevision' in content ? content.assetRevision : content.revision, title, body, accountId: connection.accountId || 'default',
        ...(needsURL ? { publicMediaUrl:publicMediaUrl.trim() } : {}), ...(platform === 'youtube' ? {privacy} : {}),
        ...(platform === 'tiktok' ? { privacy, preflightId:tiktokOptions?.preflightId, brandOrganic:brandOrganic === 'yes', brandContent:brandContent === 'yes', aiGenerated:aiGenerated === 'yes', allowComments, allowDuet, allowStitch, musicConfirmed, brandedContentConfirmed, ...(video && durationSeconds !== null ? {durationSeconds} : {}) } : {}),
      });
      setMessage(response.result.note); setConfirmed(false); if(platform === 'tiktok')setTikTokOptions(null);
    } catch (e) { setMessage(e instanceof Error ? e.message : '任务未完成，请核对平台结果'); }
    finally { try { await refresh(); } catch { setMessage('任务已结束，但刷新记录失败，请重新打开发布中心核对结果。'); } finally { setWorking(false); } }
  }

  return <Modal title="确认平台投送" description="核对目标账号、内容与平台选项；每次只提交这一条。" wide onClose={() => { if (!working && !checking) onClose(); }}>
    <div className="row gap-10 wrap"><Channel platform={platform}/><span>{connection?.mode === 'external' ? `${PLATFORM_NAMES[platform]} 独立 MCP` : '自带页面助手'}</span></div>
    <p className="info-box">本次连接：<strong>{connection?.accountName || '尚未读取'}</strong>{connection?.remoteAccount && <> · 服务内账号 <strong>{connection.remoteAccount}</strong></>}。{connection?.mode === 'external' ? '请核对该服务实际授权的账号。' : '请在官方窗口核对登录账号。'}</p>
    <Field label="关联的运营账号" hint="发布结果与运营数据会归到这个账号。"><select value={accountId} disabled={working || !!recordId} onChange={e => {setAccountId(e.target.value);edited();}}>{!accounts.length && <option value="">请先添加运营账号</option>}{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
    {accountMismatch && <p className="info-box" role="alert">该运营账号绑定了另一条 MCP 连接。请先在账号设置中切换到对应连接，再重新打开本窗口。</p>}
    <div className="creator-draft-preview"><div className="creator-draft-media">{image ? <img src={content.mediaData} alt="本次投稿素材"/> : <video src={content.mediaData} controls preload="metadata" onLoadedMetadata={e=>{const duration=e.currentTarget.duration;setDurationSeconds(Number.isFinite(duration)&&duration>0?duration:null);}} onError={()=>setDurationSeconds(null)}/>}</div><div><Field label={`标题 · ${title.length}/${limits.title}`}><input disabled={disabled} value={title} onChange={e => {setTitle(e.target.value);edited();}}/></Field><Field label={`正文 · ${body.length}/${limits.body}`}><textarea rows={7} disabled={disabled} value={body} onChange={e => {setBody(e.target.value);edited();}}/></Field></div></div>
    {platform === 'youtube' && <Field label="YouTube 可见范围"><select disabled={disabled} value={privacy} onChange={e=>{setPrivacy(e.target.value);edited();}}><option value="private">私密 · 仅自己及指定用户</option><option value="unlisted">不公开 · 持有链接的人可看</option><option value="public">公开</option></select></Field>}
    {needsURL && <section className="mcp-launcher"><Field label="公开素材地址" hint={platform === 'tiktok' ? '填写已通过 TikTok 开发者域名验证的 HTTPS 素材地址。不能填写网页、网盘预览页或本机路径。' : 'Meta 会读取这条公开 HTTPS 地址。图片需为符合平台要求的 JPEG；视频需为可直接读取的文件。'}><input type="url" value={publicMediaUrl} disabled={disabled} placeholder="https://你的素材域名/作品.mp4" onChange={e=>{setPublicMediaUrl(e.target.value);setMediaConfirmed(false);edited();}}/></Field><label className="checkbox-row"><input type="checkbox" disabled={disabled || !validURL} checked={mediaConfirmed} onChange={e=>{setMediaConfirmed(e.target.checked);edited();}}/>我已核对链接中的素材与左侧预览一致，允许平台读取。</label></section>}
    {platform === 'tiktok' && <section className="mcp-launcher">
      <div className="row between gap-10 wrap"><strong>TikTok 发布选项</strong><button className="button" disabled={disabled || checking || !connection} onClick={()=>void loadTikTokOptions()}>{checking ? '读取中…' : tiktokOptions ? '重新读取账号权限' : '读取账号与发布权限'}</button></div>
      {!tiktokOptions && <p className="small-note">先读取当前账号的可见范围与互动权限。未审核应用受私密测试限制，不能通过 MCP 绕过。</p>}
      {tiktokOptions && <>
        <p>将投送到 <strong>{tiktokOptions.creatorNickname}</strong> <span className="muted">@{tiktokOptions.creatorUsername}</span></p>
        <Field label="谁可以看这条内容"><select disabled={disabled} value={privacy} onChange={e=>{setPrivacy(e.target.value);edited();}}><option value="">请自行选择可见范围</option>{tiktokOptions.privacyOptions.map(option=><option value={option} key={option} disabled={option === 'SELF_ONLY' && brandContent === 'yes'}>{privacyNames[option] || option}</option>)}</select></Field>
        <div className="row gap-10 wrap"><label className="checkbox-row"><input type="checkbox" disabled={disabled || tiktokOptions.commentDisabled} checked={allowComments} onChange={e=>{setAllowComments(e.target.checked);edited();}}/>允许评论{tiktokOptions.commentDisabled && '（账号已关闭）'}</label>{video && <><label className="checkbox-row"><input type="checkbox" disabled={disabled || tiktokOptions.duetDisabled} checked={allowDuet} onChange={e=>{setAllowDuet(e.target.checked);edited();}}/>允许合拍{tiktokOptions.duetDisabled && '（账号已关闭）'}</label><label className="checkbox-row"><input type="checkbox" disabled={disabled || tiktokOptions.stitchDisabled} checked={allowStitch} onChange={e=>{setAllowStitch(e.target.checked);edited();}}/>允许拼接{tiktokOptions.stitchDisabled && '（账号已关闭）'}</label></>}</div>
        {video && <p className="small-note">本机视频时长：{durationSeconds === null ? '未能读取，暂不能提交' : `${durationSeconds.toFixed(1)} 秒`}；账号上限：{tiktokOptions.maxVideoDurationSeconds === null ? '平台未提供' : `${tiktokOptions.maxVideoDurationSeconds} 秒`}。公开链接素材仍由 TikTok 检查。</p>}
        <div className="settings-grid"><Field label="是否宣传自己的品牌或业务"><select disabled={disabled} value={brandOrganic} onChange={e=>{setBrandOrganic(e.target.value);edited();}}><option value="">请选择</option><option value="yes">是 · 标注推广内容</option><option value="no">否</option></select></Field><Field label="是否为第三方付费或激励合作"><select disabled={disabled} value={brandContent} onChange={e=>{setBrandContent(e.target.value);setBrandedContentConfirmed(false);edited();}}><option value="">请选择</option><option value="yes">是 · 标注付费合作</option><option value="no">否</option></select></Field><Field label="是否为 AI 生成内容"><select disabled={disabled} value={aiGenerated} onChange={e=>{setAiGenerated(e.target.value);edited();}}><option value="">请选择</option><option value="yes">是 · 添加 AI 生成标识</option><option value="no">否</option></select></Field></div>
        {brandContent === 'yes' && privacy === 'SELF_ONLY' && <p className="info-box" role="alert">付费合作不能仅自己可见，请重新选择平台允许的可见范围。</p>}
        <label className="checkbox-row"><input type="checkbox" disabled={disabled} checked={musicConfirmed} onChange={e=>{setMusicConfirmed(e.target.checked);edited();}}/><span>我同意 TikTok 的 <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">音乐使用确认</a>。</span></label>
        {brandContent === 'yes' && <label className="checkbox-row"><input type="checkbox" disabled={disabled} checked={brandedContentConfirmed} onChange={e=>{setBrandedContentConfirmed(e.target.checked);edited();}}/><span>我确认本次合作符合 <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">TikTok 商业内容政策</a>。</span></label>}
      </>}
    </section>}
    {!supported && <p className="info-box">{platform === 'youtube' ? 'YouTube 需要 MP4 视频，不能直接提交封面图片。' : '当前 MCP 投送支持 PNG、JPG 和 MP4；请先导出兼容素材。'}</p>}
    {error && <p className="info-box">{error}</p>}
    {(capabilityMissing || requiresConnectionCheck || connection?.mode === 'builtin' && !connection.builtinAvailable || !connection) && <p className="info-box">{capabilityMissing ? '这个服务没有兼容的素材发布工具。请检查所选 MCP 项目和版本。' : requiresConnectionCheck ? '请先检查连接，确认这个账号支持当前素材的发布。' : '尚未找到可用连接，请先在设置中完成连接。'}<button className="text-button" disabled={working || checking} onClick={()=>{onClose();openPublishingSettings(go);}}>前往连接设置</button></p>}
    <p className="small-note">{connection?.mode === 'external' ? '确认后，所配置的本机 MCP 将执行这一条提交。平台可能仍需处理或审核；结果不明时请先到平台核对，避免重复发布。' : '助手会填写官方发布页面，最后由你确认。登录、验证码及平台要求补充的选项需要你处理。'}</p>
    {locked ? <p className="info-box">这条内容已有提交记录。请返回发布中心核对回执并登记结果；确认未发布时可解锁重试。</p> : <label className="checkbox-row"><input type="checkbox" disabled={working || checking || !valid} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对目标账号、标题、正文、素材和平台选项，允许提交这一条内容。</label>}
    {message && <p className="info-box" role="status">{message}</p>}
    {working && <p role="status" className="info-box">正在提交，请勿重复点击。平台处理、审核或网络中断时，请根据回执核对实际结果。</p>}
    <div className="modal-actions"><button className="button" disabled={working || checking} onClick={onClose}>返回</button><button className="button primary" disabled={working || checking || !valid || !confirmed || locked || !connection || capabilityMissing || connection.mode === 'builtin' && !connection.builtinAvailable} onClick={()=>void submit()}>{working ? '提交中…' : '确认并提交'}</button></div>
  </Modal>;
}
