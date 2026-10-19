# v2.0.0 开发交接

本次为原 React + Express + SQLite 工作站的增量开发。产品：Shengzhang Studio 自媒体运营工作站，JCoal 开发。账号矩阵方向和发布授权边界见 `AGENTS.md`。

## 主要模块

- `src/pages/AgentWorkspace.tsx`、`src/agent-workspace.css`：独立 Agent 工作页、账号/模型/多选 Skills、热点与经验、自动保存、交接。
- `server/agent-workspace.mjs` 与 routes：严格字段数据包、后端重解析经验/Skills、乐观锁草稿、幂等交接。不得信任客户端传入的完整规则或凭据。
- `server/ai-routes.mjs`、`server/prompts.mjs`：逐请求模型路由，不改全局默认；明确经验优先级、生成快照与过期输入防覆盖。
- `server/active-jobs.mjs`：按内容资源管理并发；原整项目占用接口兼容。费用预留仍必须在原子 store.mutate 内进行。
- `src/useBackgroundTasks.ts`、`src/media-tasks.ts`、`server/task-journal.mjs`：加密任务进度、外部媒体状态聚合、检查点暂停/恢复、完成提醒。
- `src/workspace-save.ts`、`desktop/main.cjs` / `preload.cjs`：关闭前等待保存，后台继续/保存退出；不要在未确认外部结果时自动重试。
- `src/useContentEditDraft.ts`、`server/content-edit-drafts.mjs`：编辑器未提交正文按项目、作品、账号和当前成员加密暂存，乐观锁阻止跨窗口覆盖；关闭前等待保存，重启可恢复。正文基线变更时保留草稿供复制或显式舍弃，不自动覆盖新版本；正式保存成功后清理对应暂存。
- `server/review-work.mjs`、`ExternalWorkDialog.tsx`：完整作品 URL 规范化及账号归属，登记不代表投稿；无任何外部读取。
- `RetargetDialog.tsx`、`PublishWorkspace.tsx`：新目标独立改编稿、发布要求呈现、新飞书记录确认；保留原发布权限和真实回执处理。
- `server/glm.mjs` 与 providers：固定官方域名、独立密钥与中文诊断；免费连接探测不传项目数据，付费模型权限不以探测结果代替。
- `server/team-store.mjs`：Agent 草稿、任务日志与未提交正文按成员隔离。项目成品与确认后的知识条目仍依照原团队共享工作区规则管理。
- `server/web-skill-privacy.mjs`、`web-merge.mjs`：去除私人 Agent/任务内容，阻止中转返回注入覆盖本地数据。

## 兼容与安全要求

已有数据字段不删除，旧路由继续可用。历史模型/图片服务选择不覆盖，新建工作区才默认 Seedream。Redfox 保存密钥与启用服务必须分开。不要把 API 返回、文档、热点或用户导入 Skill 当作系统授权。

草稿与任务必须经现有加密存储；禁止明文 localStorage 保存私人需求/正文。不同账号不能混用身份、知识或异步结果。已选经验变化、资产版本变化要拒绝覆盖，费用仍记录为实际已发生/待核对。

版本元数据位于 package.json、health/settings、MCP clientInfo 和静态设置。构建前运行 Skills 编译和 TypeScript 检查；两包均包含当前版本文档。历史本地版本文档保留以便溯源。

## 验证与发布

检查命令：`node scripts/compile-copy-skills.mjs --check`、`node node_modules/typescript/bin/tsc --noEmit --incremental false`、`node --test tests/*.test.mjs`。Windows DPAPI 测试需要正常 Windows 用户权限。

生产前端：`node node_modules/vite/bin/vite.js build`；个人包：`node scripts/build-windows.mjs`、`node scripts/package-windows.mjs`；团队包：`node scripts/build-team.mjs`（不覆盖已有同版本目录）。真实付费服务与账号授权的验收范围见 `VALIDATION-2.0.0.md`。

线上仓库 `JerryCoal/shengzhang-studio`。发布只选择源码、测试、说明和许可资源，不能上传 data、cookies、密钥、浏览器会话、工作区备份、测试临时目录或运行日志。无本地 Git 元数据时通过 GitHub Git Data API 创建正常父提交并非强制更新；基于上次公开快照检查远端冲突，保留未涉及的远端文件。
