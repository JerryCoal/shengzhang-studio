# v1.25.0 团队部署交接

## 入口与边界

- `server/team.mjs` 创建 `team-app.mjs`，默认 Node 监听 `127.0.0.1:4320`；`STUDIO_TEAM_ORIGIN` 为用户访问的 HTTPS 根地址。仅 localhost 可用 HTTP 测试。
- `server/windows.mjs → profiles.mjs` 保留个人加密工作区；`server/index.mjs` 保留原开发/单密码入口。团队使用 `npm run start:team` 或发布包启动脚本。
- 不自动迁移私人工作区，也不开放公网或修改系统服务。公开发布需另行操作。

## 关键实现

- `team-storage.mjs`：私有目录权限、Windows DPAPI 包裹 `master.key`、HKDF 分离工作区与凭证密钥、AES-GCM SQLite 状态及凭证保险箱。已有数据库缺失主密钥时拒绝创建新密钥。
- `team-app.mjs`：首次初始化、PBKDF2 员工登录、12 小时内存会话、限流、成员增改停用、来源和 Host 校验、共享工作区生命周期。
- `team-permissions.mjs`：管理员配置与发布员边界，规范化路由后检查；读凭证状态和使用模型不授予修改密钥权利。
- `request-actor.mjs`：AsyncLocalStorage 保存当前员工；`activity-actor.mjs` 是供共享 domain 代码使用的浏览器安全适配，避免将 Node API 打包到前端。
- `team-store.mjs`：共享单个 SQLite 事务，投影员工 `creationSelections`、`activeCreationAccounts`、`mcpActiveAccounts`、草稿、外观、引导和未关联项目的介绍文档任务。API 不暴露 `teamPreferences`。
- `workspace-access.mjs` 与相关路由：受认证的团队模式可使用 AI/RAG/研究/资料卡/MCP，本机桌面桥在浏览器中明确不可用。
- MCP 选择、检查缓存、发布预检和评论预览分别绑定账号/员工；上游操作保留共享锁。
- 视频与封面异步任务保存发起人，旧轮询结果不能覆盖重置后的新任务。
- `TeamAuth`、`TeamSettings` 及 `App`：团队初始化、登录、权限与成员管理、轻量更新提示和活动操作者展示。

## 测试

运行 `node --test tests/*.test.mjs`；Windows DPAPI 测试必须在能使用当前 Windows 用户加密配置的环境执行。模拟调用覆盖权限、并发身份与 API 路由，不消耗真实模型费用。完整结果见验证文档。

部署用 Caddy 来自官方发布并校验摘要；包内不包含开发数据、API 密钥、初始化码或已登录平台会话。工作区下载链接沿用有效期五分钟的随机授权链接，持链接者可下载该次导出内容。
