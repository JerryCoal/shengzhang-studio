# v1.27.0 开发交接

## 功能与边界

本版新增默认 Skills 的逐步骤编辑。存量工作区没有覆盖记录时使用原出厂规则；同一基础 Skill 出现在不同工作步骤中时分别保存，避免一个入口的修改串到其他生成任务。Redfox 继续沿用 1.26.0 测试版边界。

### 数据和接口

`server/builtin-skills.mjs` 管理工作区中的 `builtinSkillOverrides`，按工作步骤 ID、基础 Skill ID 两层归属保存正文、基础版本、修订号和更新时间。正文必须非空、为有效文本，UTF-8 大小最多 24 KB；拒绝不存在或不属于当前步骤的规则。

默认规则覆盖与自装 Skills 共用 `skillsRevision`。`PUT /api/creative-skills/default` 接收 `workflowId`、`skillId`、`instructions` 和 `expectedRevision`；`DELETE` 同一路径接收目标与预期版本，恢复这一份规则。保存和恢复检查版本冲突，不接受跨步骤目标，也不修改出厂源码文件。

规则目录提供 `defaultEditable`；工作步骤下的默认规则提供当前 `instructions`、有效 `version`、`customized`、出厂 `defaultInstructions`、`baseVersion` 及可选 `updatedAt`。目录和权限状态以实际后端响应为准。

个人版覆盖记录属于当前用户的加密工作区。团队版覆盖记录属于共享工作区，服务端仅允许管理员修改，并沿用操作人记录。覆盖记录随工作区数据和备份保留；账号身份记忆、自装规则及各账号原有选择继续独立存在。

### 生成与追溯

生成流程在取得任务规则时解析当前步骤的有效默认 Skills，并固定本次请求使用的快照。模型输入、任务记录和版本追溯应使用同一份有效规则，避免保存发生在异步流程中途时出现提示词与记录版本不一致。

保存只影响后续新请求。已经运行的任务使用原快照，历史内容和历史追溯记录保留。默认规则、账号身份记忆及已选自装补充规则按现有顺序组合，编辑默认规则不改变平台登录和发布授权。

`server/skill-workflows.mjs` 将 `web-search`（联网新闻搜索）说明为千问联网搜索的规则。Redfox 按关键词检索，不使用这份规则；不要将它的自定义内容注入 Redfox 关键词路径，或宣称修改后会影响 Redfox 检索。

### 编辑界面

`src/pages/CreativeSkills.tsx` 为各步骤的每份默认规则提供编辑入口，并显示自定义状态及有效版本。弹窗预填当前正文，提供 UTF-8 字节计数、出厂原文预览、草稿下载、取消和恢复确认。`src/creative-skills.css` 提供编辑区及冲突提示样式。

草稿记录打开时的 `expectedRevision`。目录刷新不更新草稿版本，也不替换草稿正文；检测到冲突后禁用提交，保留草稿供复制或下载，要求关闭后重新打开最新规则再编辑。提交成功但目录刷新失败时，应明确提示已保存，避免用户重复提交。

`WorkflowSkillSummary` 显示已定制的默认规则名称及有效版本，并保留账号方案与自装 Skills 信息。

### 版本差异

Windows 个人版和团队版支持编辑后的实际生成。团队成员通过浏览器连接团队主机，仍执行团队管理员权限规则。

静态体验版通过本地状态接口管理默认规则，实际 AI 调用仍需完整版。独立联网网页中转版禁止编辑默认规则；如果某生成步骤存在定制覆盖，中转路径应拒绝本次生成并给出明确提示，不能静默改用出厂规则。不要把这一限制扩大成所有浏览器访问方式都只读。

## 版本与交付

`package.json` 版本为 1.27.0；服务器设置、个人和团队健康接口、独立网页中转健康接口、MCP 客户端标识、静态版及联网版设置同步使用 1.27.0。本次未调整依赖，也未改写历史版本文档与历史输出目录。

本版文档为 `UPGRADE-1.27.0.md`、`RELEASE-1.27.0.md`、`DEVELOPMENT-HANDOFF-1.27.0.md` 和 `VALIDATION-1.27.0.md`。全量自动回归共 859 项：857 通过、0 失败，2 项因未配置 `STUDIO_TEST_PYTHON` 而跳过，分别为独立 Python 文档安全检查及 Python 用词和 UTF-16 位置一致性检查。全量日志为 `.tools/default-skills1270-full-tests.log`。

Skills、TypeScript、桌面、联网版、静态版和个人及团队程序包构建均通过，对应日志为 `.tools/default-skills1270-{skills,types,desktop,web,static,windows-package,team-package}.log`。个人版打包后端的 18 项检查通过，结果见 `.tools/personal1270-package-smoke.json`。团队程序包 9 项检查通过，包含真实本机 CA TLS、管理员修改、编辑成员 403、旧版本 PUT/DELETE 409、重启后正文与版本保留、恢复出厂及停止后端口关闭，结果见 `.tools/team1270-package-smoke.json`。团队检查脚本显式设置请求 `Content-Length`，此调整仅涉及测试客户端，未修改产品代码。

CUA 已实际检查小红书自然表达润色规则：展开编辑、保存 85 字节测试正文并显示 `local.1` 版本、重开核对、取消时确认放弃草稿、放弃后保留原保存内容、确认恢复到 2,960 字节出厂正文及原版本，以及空白正文禁用保存，记录见 `.tools/default-skills1270-ui-check.json`。浏览器多标签冲突、移动宽度和下载落盘未测；冲突自动测试已覆盖。未使用真实付费 API 验证本次功能。

交付文件为 `outputs/Shengzhang-Studio-1.27.0-windows-x64.zip` 和 `outputs/Shengzhang-Studio-Team-1.27.0-windows-x64.zip`。
