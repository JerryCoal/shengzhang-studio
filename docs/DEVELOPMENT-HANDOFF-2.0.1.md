# v2.0.1 开发交接

本轮在 v2.0.0 基础上增量修改，仅本地交付。账号矩阵及确认边界遵守 `AGENTS.md`。

- `BatchPublishDialog` / `publish-batch.mjs`：项目与账号交集候选，逐项审阅、冻结范围、统一确认；先建立独立待办，再跨平台并行。MCP 原端点继续鉴权与写入提交日志，同平台/桌面助手串行，未知结果不重放。登录会话变化阻止后续请求。
- `MCPPublishDialog` 支持只保存核对结果；`expectedConnection` 在投送前校验连接身份。`mcp-platforms.mjs` 由整项目互斥改为独立发布记录锁，平台连接互斥仍保留。
- `RetargetDialog` 多目标分别使用请求 UUID 幂等交接，部分失败只处理未完成目标；执行中禁止关闭/切换 Agent。`publicationAccountChoice` 优先读取作品明确绑定账号，移除的账号不默选其他账号。
- `workspace-scope.mjs`、`WorkspaceScope`、App/context：主编辑项目与多选范围分离；多账号列表过滤，不聚合项目事实进入生成。发布/经验布局仅改样式与结构，不变更数据归属。
- `research-source-diagnostics.mjs`、`research-image-evidence.mjs`：只输出允许的安全诊断，保留可读文字及来源提供的图片描述；图片 URL 不是视觉证据，未核实详情不进入分析。不得把“0 条”直接当作关键词无内容。
- `local-qwen-connection.mjs` / `local-qwen.mjs`：仅规范化字面回环地址和 `/v1`，不走环境代理、不跟随重定向、不自动重试；原生 HTTP 限制响应大小。独立加密密钥，静态与 relay 禁止本机模型配置和生成转发。
- `LocalMCPManager` / `local-mcp-catalog.mjs`：复用现有受控桌面 IPC，只接受原生选择的受支持程序和固定参数；启动与替换连接分离，其他平台只给部署核对说明。
- Seedream/Seedance 可选水印默认关闭；明确保存的用户偏好与逐次选择继续生效。

验证、构建和打包结果见 `VALIDATION-2.0.1.md`。新功能不得通过实际收费生成、真实社交投送、无授权下载模型或任意 shell 启动进行冒烟测试。不要把结构测试当成实际浏览器验收。
