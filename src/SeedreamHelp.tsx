import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './seedream-help.css';

export const SEEDREAM_HELP_TITLE = '火山 Seedream 模型显示接入点 ID 错误';
export const SEEDREAM_HELP_SUMMARY = 'InvalidEndpointOrModel · HTTP 404 · 模型或者接入点不存在 · ep- ID · 北京区域';
const consoleUrl = 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement';
const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const curlExample = `curl https://ark.cn-beijing.volces.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "ep-xxxxxxxxxxxxxx-xxxxx",
    "prompt": "一只可爱的小猫",
    "size": "2K",
    "watermark": true
  }'`;

function DocLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noreferrer">{children} <ExternalLink size={13} aria-hidden="true"/></a>;
}

export function SeedreamHelp() {
  const [showExample, setShowExample] = useState(false);
  return <div className="seedream-help">
    <p className="seedream-help-lead"><b>A：</b><code>InvalidEndpointOrModel</code>（HTTP 404）表示指定的模型或接入点未找到，或当前账号无权访问。优先按下面的接入点配置方式排查。</p>
    <ol className="seedream-help-steps">
      <li><h3>先开通模型，再复制接入点 ID</h3>
        <p>打开<DocLink href={consoleUrl}>火山方舟开通管理（北京）</DocLink>，开通需要的 Seedream 系列。在“模型推理 / 在线推理”中找到“自定义推理接入点”，为已开通的模型创建接入点。</p>
        <p>复制形如 <code>ep-xxxxxxxxxxxxxx-xxxxx</code> 的 Endpoint ID，回到本应用“连接与设置 → Seedream 封面与关键帧”，先选择与接入点一致的模型系列，再粘贴到<b>“Seedream 模型 / 接入点 ID”</b>，点击<b>“保存图片连接”</b>。</p>
        <p className="seedream-help-note">这是用户实测有效的排查路径。官方接口也支持已开通、可访问的 Model ID；模型的展示名称不等于 Model ID。已有正确的模型 ID 配置可以继续使用，无需强制换成接入点。</p>
        <DocLink href="https://www.volcengine.com/docs/82379/1099522">接入点创建说明</DocLink>
      </li>
      <li><h3>核对北京区域与账号权限</h3>
        <p>当前应用固定调用北京区域，请使用该区域的接入点，并确认填写的 API Key 有权访问它。接口地址为：</p>
        <code className="seedream-help-url">{endpoint}</code>
        <p>其他区域的接入点不能直接与此地址混用。本应用暂未提供区域切换；“从北京区域控制台复制正确 ID”是通用提示，单凭这句话不能确定就是区域错误。</p>
      </li>
      <li><h3>确认模型已开通、接入点可用且版本未下线</h3>
        <p>在开通管理中确认所选模型已开通，在接入点页面确认状态可用、绑定的模型系列正确。ID 请从控制台复制，检查有无遗漏、多余空格或版本日期写错；不要填写模型中文名称、API Key 或完整网址。</p>
        <p>切换上方“模型系列”会重新填入预设模型 ID，因此请<b>先选系列，再粘贴 ep- ID</b>。保存后回到封面或关键帧页面，核对模型与预算，再手动生成一次。</p>
        <DocLink href="https://www.volcengine.com/docs/82379/1350667">模型弃用与下线说明</DocLink>
      </li>
      <li><h3>仍报错时，提供这些排查信息</h3>
        <p>记录应用版本、模型系列、打码后的 model 值、请求域名和完整报错文字。若服务商控制台提供 Request ID 或错误返回 body，也可一并提供脱敏后的内容。</p>
        <p>不要发送完整 API Key、Authorization 请求头或含密钥的截图。阅读本说明不会提交生成请求；实际测试生成会按服务商规则计费。</p>
      </li>
    </ol>
    <div className="seedream-help-example">
      <button type="button" className="text-button green" aria-expanded={showExample} onClick={() => setShowExample(!showExample)}>{showExample ? '收起' : '查看'}开发者调用示例（可选）</button>
      {showExample && <div><p>以下为 Bash / cURL 示例。先在本机设置环境变量 <code>ARK_API_KEY</code>，将示例 ep- ID 换成自己的接入点 ID。日常使用只需在设置页填写，无需运行命令。</p><pre><code>{curlExample}</code></pre><p>JSON 内不含注释，可作为请求格式参考。手动执行会产生一次图片生成请求。</p></div>}
    </div>
    <div className="seedream-help-sources"><DocLink href="https://www.volcengine.com/docs/82379/1541523">官方图片接口</DocLink><DocLink href="https://www.volcengine.com/docs/82379/1824121">图片生成教程</DocLink></div>
  </div>;
}
