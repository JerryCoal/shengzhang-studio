# v1.7.0 开发进度与恢复清单

2026-10-14，用户要求「先保存当前工作并且上传 GitHub」。暂停功能开发，保留 Windows 版、旧版下载和当前用户数据。

## 已落地代码

- `server/mcp-client.mjs`：Streamable HTTP MCP 客户端，只允许本机字面量地址，工具发现、JSON/SSE、会话清理，无发布重试。
- `server/mcp-platforms.mjs`：连接配置、工具能力判断、登录二维码、确认发布、评论预览与导入；每用户保险箱。
- `desktop/mcp-server.cjs`：内置有鉴权 MCP；启动令牌只在进程中传递。
- `desktop/main.cjs`、`creator-window.cjs`、`comment-window.cjs`：官方页面助手自动准备、最终确认和评论自动返回。
- `server/qwen.mjs` 及路由、模型目录、用户保险箱、Web 中转：Qwen Plus / Flash；保留 DeepSeek。
- 前端 MCP 设置卡片、发布弹窗、评论预览弹窗、Qwen 配置与分阶段模型选择。
- 新增 MCP / Qwen 测试；补充用户重启隔离、Web 中转边界测试。完整回归 226 项通过。

## 下次优先继续

1. 排查外部小红书 MCP v2.5.5 本地启动/握手失败。下载文件位于本机 `.tools/xhs-mcp-2.5.5/`，校验已通过；测试工具 `.tools/verify-upstream170.mjs` 会启动隔离本机服务、只发现工具、退出时关闭服务。不要直接把握手失败当作平台登录错误。
2. 检查 MCP 设置、Qwen 卡片、发布和评论弹窗的桌面/窄屏布局及交互。重点核对错误后的重新操作、重复点击、长任务和退出行为。
3. 真实账号分步验证：先登录和读取自有作品评论，再填写草稿。没有具体内容的用户确认，不点击最终发布。
4. 如获得真实 Qwen 测试配置，做小额生成验证。密钥只在应用设置输入，不进入源码、日志和文档。
5. 真实联调通过前保持测试版标记，不更新为正式版，不宣称评论全量或平台永远可用。

## 本机证据

- `test-results/tests170.log`：226 项回归。
- `test-results/mcp170-native/result.json`：离线 Electron 双平台执行结果及截图。
- `.tools/native-mcp170.cjs`、`.tools/prepare-native170.mjs`：本地离线原生测试工具。
- `.tools/verify-bundled170.mjs`：打包后重启与 DPAPI 持久化验证。

本机调试工具、测试用户数据、第三方下载程序、凭证和个人文件不上传源码仓库。GitHub 发布只包含允许公开的源码、测试、文档和 Windows 发行包。

## 参考

- [小红书 MCP 项目](https://github.com/xpzouying/xiaohongshu-mcp)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Qwen OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [Qwen 结构化输出](https://help.aliyun.com/en/model-studio/qwen-structured-output)
