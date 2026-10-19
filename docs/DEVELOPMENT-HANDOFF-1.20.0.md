# v1.20.0 开发交接

## 本次改变

项目编辑器增加介绍文档自动填入。复用 `src/document-text.ts` 的本机解析，用户核对预览后发送 DeepSeek，返回有原文引用的字段候选，用户选择后经原子比较写入现有自动保存流程。

本版同时带入未发布的 v1.19.1 小红书话题修复；详见 `docs/DEVELOPMENT-HANDOFF-1.19.1.md`。线上公开包仍是 v1.19.0，本地版本不代表已发布。

## 关键模块

- `server/project-brief-import.mjs`：严格输入/输出 schema、字段长度、原文引用校验与固定 DeepSeek V4 Pro 提示词。不执行文档内指令，不允许预算、日期、渠道、类型等字段。
- `server/project-brief-import-routes.mjs`：本机加密工作区权限、预估费用、预算预留/结算、请求去重、每项目互斥、保存候选；启动恢复不确定任务。
- `src/components/ProjectBriefImport.tsx`：本地读取、编辑预览、费用确认、异步恢复、逐项核对与应用。
- `src/useProjectAutosave.ts`：`flush(force)` 可保存尚未输入的草稿；`applyPatch(patch, expected)` 一次性检查选中字段并写入，冲突时整次不应用。
- `server/app.mjs`：创建项目时将 `new` 草稿的提取费用与结果迁移到项目；正在提取时拒绝提前创建。

## 数据与接口

`GET /api/brief-import?editorKey=new|项目ID` 返回当前用户该编辑器的最后一条任务及配置状态。

`POST /api/brief-import/estimate` 输入 `{editorKey,sourceName,text}`，不请求模型，返回预算预留估算。

`POST /api/brief-import` 输入上述字段加 `{requestId:UUID,confirmed:true}`。响应 `{job}`；首次请求等待模型完成。HTTP 请求活跃期间仍受既有用户退出/任务保护约束；前端不锁住整个窗口。

状态存在当前用户加密工作区 `briefImports`：任务编号、编辑器归属、源文件名、输入哈希、八字段 baseline、状态、候选、费用。完整输入正文不持久化。保留最近 20 条任务的候选与 baseline，旧任务仍保留费用记录。现有项目同时在 `p.usage` 记录费用，新项目创建时迁移；不要重复叠加统计。

任务状态：running → completed / failed / uncertain。同 requestId 同输入返回原任务，不重复调用；改变输入则 409。进程重启时 running 改 uncertain，不自动付费重试。模型引用无效仍按有效用量或预留金额记账。

## 约束和后续注意

- 本功能仅本机加密用户工作区可用，远程中转网页版和静态站不调用此接口。
- 只发送当前文档预览；不合并其他项目、语料库、登录资料。原文引用校验不能证明语义绝对可靠，事实字段保留人工确认。
- 新建/编辑共用流程；后来的用户编辑受前端比较保护，多窗口修改仍由原有草稿版本检查保护。
- 如果未来增加「丢弃新项目」按钮，需要同步归档该编辑器的 `briefImports`，不能让旧候选与费用串入新草稿。
- 扩展更多文件格式应复用现有增强解析组件，不能绕过本地解析边界。

测试使用合成文档、假模型响应与隔离工作区，不包含用户密钥。具体结果与未做事项见 `VALIDATION-1.20.0.md`。
