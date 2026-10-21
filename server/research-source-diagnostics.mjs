// Only local, allowlisted categories leave the transport boundary. Never echo
// upstream messages, account names, paths, cookies, tokens or provider payloads.
const categories = {
  mcp_not_running: ['服务未启动', '在连接与设置打开“本地 MCP 管理”，启动当前账号服务，再检查连接。'],
  mcp_unavailable: ['连接中断或超时', '核对本机服务是否仍运行；等待浏览器依赖准备完成后再检查，不要反复提交采集。'],
  mcp_auth: ['服务访问令牌不匹配', '核对 MCP 访问令牌。服务令牌与平台扫码登录是两件事。'],
  mcp_http: ['服务返回 HTTP 错误', '核对服务地址、端口和适配版本；本次未自动重试。'],
  mcp_arguments: ['工具参数不兼容', '核对所用 MCP 项目和版本；连接成功不代表研究工具兼容。'],
  mcp_browser_startup: ['配套浏览器启动失败', '检查外部服务的浏览器依赖与 Windows 组件；这不是关键词没有内容。'],
  mcp_login: ['平台登录尚未确认', '进入当前平台账号的连接设置，扫码后检查平台登录状态。'],
  mcp_verification: ['平台需要人工验证', '打开该服务的官方平台窗口，人工完成验证后再决定是否重试。'],
  mcp_rate_limited: ['平台或服务暂时限流', '暂停采集，按平台提示等待；不要循环重试或更换账号绕过限制。'],
  mcp_response: ['服务响应未完成', '检查服务日志与登录状态；已取得的其他内容仍保留，不自动重复请求。'],
  mcp_tool: ['工具未完成操作，具体原因未确认', '检查该服务的登录、页面和本机日志；不要上传 Cookie 或原始响应，已提交发布需先核对结果。'],
  mcp_protocol: ['服务返回格式不兼容', '核对 MCP 项目、版本和工具能力；可复制此安全诊断，不要粘贴 Cookie 或原始响应。'],
  mcp_schema: ['搜索或详情字段不兼容', '核对服务项目与版本。已保留可读取的搜索摘要，详情身份或字段未通过核验时不送入分析。'],
  mcp_busy: ['当前账号服务正忙', '等待该账号已有操作结束后再开始研究；不要重复点击。'],
  source_unknown: ['来源读取未完成，具体原因未确认', '先检查服务和登录，再查看来源报告；仅凭“0 条”不能判断没有相关内容。'],
};
export function researchSourceDiagnostic(error, stage = 'source') {
  const code = Object.hasOwn(categories, error?.code) ? error.code : error?.status === 409 ? 'mcp_busy' : 'source_unknown';
  const [message, nextStep] = categories[code];
  return { code, stage: ['connection', 'login', 'search', 'detail', 'source'].includes(stage) ? stage : 'source', message, nextStep };
}
