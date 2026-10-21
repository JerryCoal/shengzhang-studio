// Informational catalog only. Web input never becomes a command or argument.
export const LOCAL_MCP_CATALOG = {
  xiaohongshu: { name: '小红书', project: 'xpzouying/xiaohongshu-mcp', program: 'xiaohongshu-mcp-windows-amd64.exe', url: 'https://github.com/xpzouying/xiaohongshu-mcp', managed: true, requirement: '人工下载并解压 Windows 主程序；不要选择 login 工具。首次运行可能需要准备浏览器依赖。' },
  douyin: { name: '抖音发布', project: 'panwenda/douyin-publish-mcp', program: 'douyin-publish-mcp.exe', url: 'https://github.com/panwenda/douyin-publish-mcp', managed: true, requirement: '人工下载并解压 Windows 发布程序，保留配套文件并安装 Chrome。搜索和评论另需独立采集服务，不能当作发布服务已有能力。' },
  instagram: { name: 'Instagram', project: 'IvanBBaev/instagram-mcp', url: 'https://github.com/IvanBBaev/instagram-mcp', managed: false, requirement: '按随包 MATRIX-MCP-SETUP.md 配置受支持 Node 服务、Meta 应用和专业账号授权；本轮不提供该服务的一键启动。' },
  youtube: { name: 'YouTube', project: 'YouTube MCP 与本机 stdio 桥接', url: 'https://developers.google.com/youtube/v3', managed: false, requirement: '按随包 MATRIX-MCP-SETUP.md 准备服务、Google OAuth 与一账号一授权目录，再手工启动受支持桥接。' },
  tiktok: { name: 'TikTok', project: 'thenavidm/tiktok-mcp-cli', url: 'https://github.com/thenavidm/tiktok-mcp-cli', managed: false, requirement: '按随包 MATRIX-MCP-SETUP.md 准备 Node 服务与官方应用授权；发布另需对应权限和用户核对，本轮不提供该服务的一键启动。' },
};
export function localMCPDeploymentGuide(platform) {
  const entry = LOCAL_MCP_CATALOG[platform];
  if (!entry) throw new Error('未支持的平台');
  return [
    `请帮助我核对 ${entry.name} MCP 的本地部署步骤，不要直接安装或执行命令。`,
    `工作站适配项目：${entry.project}；来源：${entry.url}。这不是对最新上游版本的兼容保证，请先核对版本和依赖。`,
    entry.requirement,
    entry.managed ? `准备好 ${entry.program} 后，由我在 Windows 工作站“本地 MCP 管理”通过原生文件选择器选定主程序并启动。工作站固定启动参数，不接受网页输入 shell、脚本或任意参数。` : '未受控的程序必须由我在应用外人工部署；不能向工作站输入 shell 命令或要求模型自主安装。保留手动填写服务地址的使用方式。',
    '服务只绑定 127.0.0.1，不开放公网；当前连接器接收本机 /mcp HTTP 地址。远程主机服务请先由管理员建立受控本机接入，不要关闭来源、令牌或网络保护。',
    '每个工作站用户、平台账号使用独立服务目录与端口；不要复用别人的 Cookie、令牌、Chrome Profile 或 OAuth tokens.json。密钥仅保存在本机，不粘贴到聊天、日志或截图。',
    '依次人工核对：依赖就绪 → 进程启动 → MCP 工具连接 → 平台账号登录 → 所需搜索/评论/发布能力。进程运行不等于平台登录成功。',
    '工作站停止按钮只停止由工作站启动且归属当前账号的进程；自行运行的服务由我在原窗口停止，不按端口或程序名强制结束未知进程。',
    '最后仅给我安装核对清单与故障排查说明。需要执行、授权、下载或发出平台请求时先征得我同意；不要真实采集、发布、付费或替我完成平台验证。',
  ].join('\n\n');
}
