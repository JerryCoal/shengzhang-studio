# v1.21.0 开发交接

## 本次目标

把临时分散的 Skill 选择合并到设置，支持所有实际使用生成模型的步骤。保留少量长期默认规则、每步一份可选用户规则；确定性 API 不套用自然语言规则。

## 数据与兼容

- `server/skill-workflows.mjs`：20 个工作步骤的稳定 ID、标签、用途与平台映射。
- `server/ai-skill-registry.mjs`：工作步骤到内置规则映射；18 份默认 Skill 编译到 `copy-skills.generated.mjs`。
- `server/creative-skills.mjs`：导入校验、工作步骤范围、安装去重、选择、禁用/删除回退及修订冲突保护。导入文件最多 24 KB，目录最多 30 份。
- `state.skillSelections`：工作步骤 → 安装记录 ID。空或无效选项回到默认；沿用 `skillsRevision` 作并发保护。
- `installedSkills[].workflowId`：新安装目标。旧文案安装记录无此字段，仍按原平台范围兼容。
- `PUT /api/creative-skills/selection`：`{workflowId, skillId, expectedRevision}`，`skillId` 为空表示默认。浏览器本地 API 使用同一存储逻辑。
- `workflowSkillTrace`：记录工作步骤、内置版本与正文、选中规则的精简快照；不保存整份安装文件元信息到任务追溯。

本机用户的加密存储机制不变，不添加跨账号或跨用户共享。设置现为用户级按步骤选择，不代表已实现按平台账号单独配置。

## 实际调用入口

- `ai-routes.mjs`：策略/策划、五平台文案、两类审核、评论分类/复盘、资料卡。请求开始捕获本步规则，放入模型输入；后续版本检查继续使用同一快照。旧 `skillId` 仅作兼容，中央设置优先，新前端不再发送它。
- `project-brief-import-routes.mjs`：固定 DeepSeek 提取，在系统规则中加入“项目概要提取”规则，估价与调用使用同样指令。原文输入和输出校验不变。
- `research-routes.mjs`：一轮开始冻结查询规划、网页搜索和研究分析三份设置；复用已采集数据时仅调用分析。仅实际执行的步骤会产生调用和费用。
- `qwen-search.mjs`：联网模型收到网页搜索规则，查询时间窗与真实搜索返回仍由程序控制。
- `cover-generation.mjs`、`media-generation.mjs`：封面、首帧、尾帧和视频分别读取对应规则，在模型调用前检查完整提示词长度与预算。
- `src/pages/CreativeSkills.tsx`：统一设置与只读 `WorkflowSkillSummary`。`src/media-prompt-preview.ts` 与后端使用同一提示词组装逻辑，捕获错误，避免无效或过长规则导致弹窗崩溃。

API 字段定义、产品事实、原文引用、本地词库、预算与发布权限高于用户表达偏好。不要把 Skill 当工具授权或可执行代码。外部网页、文档和评论仍只作为资料处理。

## 继续开发

新增 AI 环节时同时更新工作步骤注册、内置规则映射、真实调用入口、预算与端到端测试。设置页面会展示注册表中的新步骤。不要只增加一个下拉列表而不验证真实请求内容。

后续矩阵功能可在用户默认选择上增加账号级覆盖，但需明确账号、项目与用户层级，保存快照并避免异步任务串用；本版不提前重构。

构建：先运行 `node scripts/compile-copy-skills.mjs --check`，再执行 TypeScript、测试、桌面/Web/静态构建，最后 `node scripts/build-windows.mjs` 和 `node scripts/package-windows.mjs`。测试使用合成资料，不能读取个人工作区或真实密钥。

验证与网页版当前边界见 `VALIDATION-1.21.0.md`。前序项目导入实现见 `DEVELOPMENT-HANDOFF-1.20.0.md`。
