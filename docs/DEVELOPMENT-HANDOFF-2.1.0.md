# 2.1.0 开发交接

## 来源与入口

以本机 2.0.2 源码为基础，修改前重编译后台与现有发布包字节匹配。基线后台 SHA-256：`05352594485f0789c1a2e39356dc02086252b535bae8989a8c8bd65b27d772b7`。基线桌面主进程：`9a6b3488f874cab514b4d0b7232ad08f9d56c52c6a389768cbd1e5af84af4be5`。修改后哈希变化是预期，不可用修改后的编译物反推基线不匹配。

开发需 Node >=22.13；本次打包运行时为 Node 24.19.0、Electron 44.3.0，团队 Caddy 2.11.7。`pnpm build` 完成类型与前端构建后，运行 `pnpm run build:windows`、`node scripts/package-windows-release.mjs` 及 `pnpm run build:team`。Windows 收尾脚本拒绝同名覆盖，`--verify` 复核 ZIP 内每个文件和清单。新构建先使用独立合成数据位置。

## 模块

| 文件 | 责任 |
|---|---|
| server/work-storage.mjs | 独立加密记录/事件、单调游标、归档及同步事务 |
| server/work-control.mjs | 计划批准、队列、租约、依赖、命令、成果与通知原子交付、HTTP |
| server/work-executors.mjs | 三类受限业务执行、冻结账号/模型/凭据指纹、既有锁和用量复用 |
| server/work-planning.mjs | 白名单 AI 规划、独立预算、局部修订范围、回执与未知费用 |
| server/work-planning-control.mjs | 单次估算、规划运行、只生成待批准草案，陈旧建议另存 |
| server/work-controller-history.mjs | 按成员、项目与账号范围恢复总控事实对话，有限上下文 |
| server/work-experience.mjs | 已成功成果的候选经验、明确采纳与来源追溯 |
| server/work-scheduling.mjs | 供应商名额、只在未派发且无费用证据下有限退避 |
| server/work-backup.mjs | 当前归属导出、摘要校验、空库恢复与历史审批降权 |
| src/pages/WorkControl.tsx / src/work-control.ts | 四主入口、冻结版本、草稿/游标、身份变化收口、通知导航 |
| desktop/main.cjs / desktop/preload.cjs | 后台进度 IPC、可信通知、保存退出和页面崩溃隔离 |

## 核心约束

业务角色只允许 `xiaohongshu-copy`、`douyin-research`、`douyin-script`；`controller-planning` 是内部规划任务，不能用它伪造业务执行权限。模型输出不决定预算、模型、工具、URL 或批准。HTTP 客户端不能提交成功状态、回执、费用或租约。

`markSent` 必须在实际外部请求前完成持久记录，并重复校验权限与额度。请求未知不自动重试；已保留 `result_ready` / `planning_result_ready` 回执只恢复保存。终止请求与真正停止分离。一个事务同时保存成果、业务映射、运行状态、事件和通知，失败全部回滚。

活动使用鉴权短轮询，每次分页重新验证成员；序列空洞不得直接跳过。归档后旧游标返回 409/resync，先读取归档再接续热事件。UI 不自动切换正在编辑的成果版本。

同一计划新版本保留旧批准和无关运行，只对变化节点及依赖闭包新建运行。任务固定角色/账号；局部建议只改目标节点的规划字段，保留用户模型、预算、资料、Skills。生成建议时原计划已改变则保存独立草案，不覆盖新版本。

## 接口摘要

- `/api/projects/:id/work-plans`、`/api/work-plans/:id`、`/approvals`：规则草案、版本和业务批准。
- `/api/projects/:id/planning/estimate`、`/planning-runs`、`/api/planning-runs/:id`：15 分钟单次报价、单独确认规划预算、持久运行。
- `/api/tasks`、`/api/tasks/:id`、`/api/task-runs/:id`、`/commands`、`/events`、`/archive`：后台任务与事实事件。
- `/api/artifacts/:id/versions/:version` 和 `/adopt`：不可变成果版本，候选明确采用。
- `/api/tasks/:id/view`、`/messages`、`/api/projects/:id/controller-view`：按成员的草稿、阅读位置和对话。
- `/api/notifications`、`/:id/read`、`/:id/delivery`：生成、送达尝试和已读分离。
- `/api/work-backup`：包含任务历史的当前归属明文业务备份。旧 `/api/backup` 兼容旧内容格式，不包含新任务表。

## 安全恢复 API

离线工具可调用 `createWorkBackup(source,{ownerId}).exportForOwner(ownerId)`；验证使用 `validateWorkBackup`，恢复使用 `createWorkBackup(target,{ownerId}).importIntoEmptyStore(backup)`。调用前核对函数签名和当前成员上下文。目标必须是同归属、独立空库；禁止覆盖现用数据。恢复保留 ID、费用和原事件序列，待执行记录暂停/待核对，审批、命令降为历史，不恢复执行授权。

完整数据库回退另行处理：停止所有写进程，保存配套用户/密钥库，恢复升级前副本；旧程序不能写新 schema。发布源码使用明确白名单，排除 data、cookies、.env、.tools、outputs、临时研究资料与真实备份。

验证结论以 `VALIDATION-2.1.0.md` 和发布附带的 `Shengzhang-Studio-2.1.0-validation.json` 为准；实现覆盖明细见 `WORK-CONTROL-PROGRESS.md`。没有执行真实付费模型、真实 MCP 投稿或生产工作区迁移，不应据合成成功宣称已实账号联调。
