# 生长 STUDIO v1.18.0 开发交接

日期：2026-10-15。状态：本地测试版，未发布 GitHub。整体架构、历史发布与已有功能见 [v1.17.0 交接](DEVELOPMENT-HANDOFF-1.17.0.md)，本文件描述本次增量。

## 本次交付

- `document-context`：选择文档 → 模型提炼 → 原文引用校验 → 用户逐项采纳 → 冻结进新策略 → 文案使用策略快照。
- `natural-copy-editing`：普通文案调用内润色，不另开一个模型请求。文案仍经过原有敏感词流程，用户自装 Skills 仍可选。
- Docling 可选本机增强解析：保留基础提取，独立安装 Python 解析环境与 PDF 模型。
- 外部 MCP 多账号：独立配置、端口、目录、启动记录、重启与目标账号校验。

## 关键模块

| 路径 | 职责 |
| --- | --- |
| `skills/document-context/SKILL.md` | 资料用途、证据与缺失信息规则 |
| `skills/natural-copy-editing/SKILL.md` | 自然表达、事实与价格保留 |
| `server/ai-skills-manifest.mjs` / `ai-skill-registry.mjs` | 16 份内置规则与 15 个入口的映射 |
| `server/document-context.mjs` | 提炼输入、引用检查、采纳、失效判定、文风来源选择 |
| `server/ai-routes.mjs` / `prompts.mjs` / `ai.mjs` | 原模型路由、预算、生成锁、快照与三家文本接口 |
| `server/workflow.mjs` / `rag.mjs` | 资料用途、结构化分段、事实检索排除文风样本 |
| `src/pages/Corpus.tsx` / `src/components/CorpusContext.tsx` | 导入用途、资料卡确认、出处查看与采纳 |
| `desktop/document-parser.cjs` / `.py` | 本机子进程解析、文件限制、超时与隔离清理 |
| `desktop/document-parser-setup.py` | 可选解析模型准备 |
| `scripts/Install-Docling.cmd` / `install-docling.ps1` | 用户可运行的独立组件安装入口 |
| `src/components/DocumentParserSettings.tsx` / `src/document-text.ts` | 可选解析配置、模式选择与基础回退 |
| `desktop/mcp-account-storage.cjs` / `mcp-launcher.cjs` | 独立目录、Windows 权限、启动记录与服务生命周期 |
| `server/mcp-platforms.mjs` | 加密账号连接、切换与发布/采集账号绑定 |
| `src/pages/MCPConnections.tsx` | 多账号设置、启动、扫码与登录保存状态 |
| `desktop/main.cjs` / `preload.cjs` / `src/desktop.ts` | 受信页面 IPC、用户范围与退出清理 |
| `server/local-document-privacy.mjs` / `web-merge.mjs` / `src/web-payload.ts` | 新本地资料不随通用网页请求发送，合并保留本地快照 |

## 资料卡约定

用途：`product_facts`、`event_plan`、`brand_guidelines`、`style_sample`。旧资料默认产品事实。文风样本不参加事实 RAG，品牌规范仅作为品牌规则。

本机接口：GET/POST/DELETE `/api/projects/:id/corpus/context`，POST `/api/projects/:id/corpus/context/adopt`。生成须显式选择文档并确认；采纳须提交候选 ID、版本与条目 ID。每次最多 8 份、24,000 字符，不静默截断。

提炼复用策略模型配置，不新增 API 密钥或模型设置。结果为 `items` 和 `missing`；每个条目必须附对应输入段落的连续原文。引用匹配能证明文本来源，不能证明模型的转述语义正确，因此保留用户核对。

项目保存候选与采纳卡；源资料指纹变化后停止用于新策略。策略生成时保存 `documentContextSnapshot`、`styleReferencesSnapshot`。旧策略没有快照时不自动附后来资料；用户应生成新策略。只有已采纳 `style_note` 对应的文风样本参与表达参考，最多 3 份各 1,200 字符。

## MCP 登录与权限

旧默认目录保持原位，新账号分目录、临时目录与端口。启动信息仅含本机程序路径与端口，连接令牌仍走现有加密 vault。应用不读取或输出上游 Cookie 正文，只检查登录文件存在/修改状态；Windows 目录 ACL 限制为当前系统用户与 SYSTEM。

发布/评论请求带明确 `accountId`，服务端校验当前账号；账号切换或工作站退出不能让旧异步结果覆盖新的连接。外部程序只支持已审查的启动参数，不运行来自 Skill 或文档的命令。不会主动终止不属于本应用的端口进程。

本版不承诺永久登录，也不解决同一平台账号在多个网页会话互踢。内置页面助手与外部 MCP 是不同会话，不能把前者的登录当成后者已保存。真实多账号扫码、评论与最终发布仍应使用用户授权的账号验证。

## 隐私、开源与回归

Docling 文档转换在本机执行，模型组件准备阶段可能下载文件；解析阶段禁用网络。之后主动提炼/生成会把所选正文或检索片段发送给配置的 AI 服务，界面需如实提示。

规则适配了 Humanizer-zh、Humanizer、marketingskills，保持 MIT 许可与署名，见 [第三方说明](THIRD-PARTY-SKILLS.md)。不要把开源规则描述为已证明能提高流量或绕过平台审核。

更新 Skill 后运行 `node scripts/compile-copy-skills.mjs`；检查 `pnpm check`，前端 `pnpm build` / `pnpm build:web` / `pnpm build:static`，Windows `pnpm build:windows`，归档 `node scripts/package-windows.mjs`。打包脚本读取 package.json 版本，并复制新增 desktop helper、安装脚本和说明。

本次测试与真实验证边界见 [验证记录](VALIDATION-1.18.0.md)。不要将模拟 AI 响应称为真实生成质量评估；不要将伪造 Cookie fixture 称为真实账号登录成功。公共包中不得包含工作区、API 密钥、Cookie、Python 环境或浏览器个人资料。
