import { ExternalLink, Info } from 'lucide-react';

/** Shared explanation; publishing permissions must not be confused with comment access. */
export function PublishingNotice() {
  return <details className="publishing-notice">
    <summary><Info size={16}/>为什么最后一步仍由我确认？</summary>
    <div className="publishing-notice-body">
      <p>Windows 版可在官方网页中自动上传素材、填写标题与正文；你核对账号、内容和可见范围并确认提交后，助手点击发布按钮、监听回执。平台没有明确返回作品编号时，会锁定重试并提醒你检查。也可继续导出素材手动上传，无需填写发布接口凭证。</p>
      <div className="publishing-reasons">
        <div><b>抖音</b><p>官方投稿能力有应用类型、权限及使用场景要求，SDK / H5 投稿仍需用户在抖音内操作发布，不能当作通用后台自动投送。本应用的营销创作场景不据此接入自动发布。</p><a href="https://developer.open-douyin.com/docs/resource/zh-CN/dop/operation-standard/platform-capabilities/useclue" target="_blank" rel="noreferrer">官方发布能力说明 <ExternalLink size={12}/></a></div>
        <div><b>小红书</b><p>本应用未接入可用的官方自动发布接口，分享能力也不等同于无人值守发布。桌面助手在官方页面中操作，不代表获得官方投稿接口权限。素材导出与手动发布入口继续保留。</p><a href="https://agora.xiaohongshu.com/doc" target="_blank" rel="noreferrer">官方开放平台文档 <ExternalLink size={12}/></a></div>
      </div>
      <p className="small-note">计划时间仅用于待办。已授权的评论读取属于独立功能，不会上传或发布作品。</p>
    </div>
  </details>;
}
