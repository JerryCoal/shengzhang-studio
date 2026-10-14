# v1.8.0 开发续接

日期：2026-10-14。当前源码及 Windows 本地测试包为 v1.8.0；GitHub 此轮没有上传。此前 v1.7.1 包保留。

## 已完成

- `server/creative-skills.mjs` 与类型声明：纯文本 Markdown 预览、安装、启停、删除、按平台与步骤选择，24 KB/30 项限制，乐观版本保护。
- `server/creative-skill-catalog.mjs`：内置目录和实际使用规则快照。`skills/marketing-copywriting` 新增，XHS 与敏感词复核规则更新，编译至 `copy-skills.generated.mjs`。
- `server/ai-routes.mjs` 正常 copy 按用户所选 ID 从本地状态解析规则；OpenAI/DeepSeek/Qwen 共用提示词。审核/价格语义路径不加载自装规则。完成输出本地筛查后保存来源。
- 桌面 API、浏览器加密本地 API、设置管理、生成选择器与内容预览来源展示接线。历史恢复和复检保留正确来源。
- Web 最小化请求移除所有安装目录与历史规则快照；三方结果合并仅在本地恢复匹配的历史来源。
- [调研方案](RECENT-CONTENT-RESEARCH.md)、[内置规则来源](CREATIVE-SKILLS-SOURCES.md)、[使用说明](UPGRADE-1.8.0.md)、[验证记录](VALIDATION-1.8.0.md)。

## 待用户确认的网页边界

自动审批曾拒绝“把所选自装 Skills 随网页请求发给远程后端”的补丁，理由是此前用户要求只在本地保存，未明确批准这些规则的外传。已向用户询问是否允许仅传本次选中的规则，未收到回复时，不得将超时当作批准。

当前安全实现：联网托管网页仍可本地安装/管理，但生成只显示内置规则；`webPayload` 在发送与写入任务锁前拒绝自装规则生成。Windows 的本地后端生成接线已完成，并在弹窗说明规则会发送给用户选择的模型。

若用户之后明确同意远程传输，再完成：最小化单条规则负载、严格 relay 字段校验、前端模式解锁、三家模型及断网/冲突回归，并更新文档。不发送完整目录或其他稿件的规则；不要执行此前被拒绝且包含完整 sourceText 的旧补丁。

## 下一阶段

用户的热点工作流已完成研究但尚未编写采集新功能。依方案优先实现“近七天高互动参考库”，先小红书 MCP 受控搜索、详情时间复核、本地清洗、可追溯参考卡与用户采纳。外部参考与产品事实分库存储；现有新闻关键词相关度不是爆款排名，现有语料检索为本地关键词检索，不宣称向量 RAG。

## 本地验证

- `node scripts/compile-copy-skills.mjs --check`
- `node node_modules/typescript/bin/tsc --project tsconfig.json --incremental false --noEmit`
- `STUDIO_TEST_PYTHON` 指定可用 Python 后运行 `node --test tests/*.test.mjs`：254 项通过。
- `.tools/skills-ui180.cjs` 为临时开发页面离线 UI 验证，结果在 `test-results/skills180`；`.tools/verify-bundled180.mjs` 用隔离资料验证打包后的实际后端。
- 不把 `.tools`、`test-results`、`data`、Cookie、密钥或用户工作区提交到 GitHub。根目录 `cookies.json` 已加入忽略。

本次没有真实付费写作调用或真实最终发布；此前小红书 11 条自有作品评论验证仍见 v1.7.1 记录。

最终本地包：`outputs/Shengzhang-Studio-1.8.0-windows-x64.zip`，195,854,247 字节，146 文件 CRC 检查通过，SHA-256 `5627cac20bf751461a1d032a1f9acd6e4d6fc2589919d1aeb238c97314099510`。4340 临时预览服务与全部自建测试窗口已关闭；下次测试请重新启动隔离工作区。
