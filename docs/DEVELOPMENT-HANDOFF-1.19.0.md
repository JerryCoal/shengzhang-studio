# v1.19.0 开发交接

日期：2026-10-15。本版以 [GitHub Pre-release](https://github.com/JerryCoal/shengzhang-studio/releases/tag/v1.19.0) 测试版提供，源码与 Windows 包包含 v1.18.0 的累计更新。本文补充 [v1.18.0 交接](DEVELOPMENT-HANDOFF-1.18.0.md)，不替代原有本地保险箱、任务、发布日志与数据迁移机制。v1.18.0 没有独立 Release，旧文档中的“未上传”是当时状态。

[下载 Windows x64](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.19.0/Shengzhang-Studio-1.19.0-windows-x64.zip) · [单独下载本交接文档](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.19.0/DEVELOPMENT-HANDOFF-1.19.0.md) · [项目源码](https://github.com/JerryCoal/shengzhang-studio)

## 本轮实现

统一五平台账号入口与 MCP 调用；抖音同账号分开发布/采集地址；增强同话题内容证据与 AI 分析；界面改为中性配色。真实海外 OAuth、平台权限与最终发布仍待使用者账号验证。

| 模块 | 职责 |
| --- | --- |
| `server/platform-catalog.mjs`、`src/types.ts` | 五平台标识、名称、研究数据类型与历史默认值 |
| `server/matrix-adapters.mjs` | 上游工具能力识别、参数适配、结果清洗、发布选项、评论及搜索 |
| `server/mcp-platforms.mjs` | 连接与账号绑定、主/采集服务路由、发布确认、预检、日志与研究入口 |
| `server/matrix-stdio-bridge.mjs` | 受限本机 HTTP → stdio 桥接，不从请求接收可执行命令 |
| `scripts/start-matrix-mcp.mjs` | 从本机配置启动桥接 |
| `scripts/prepare-youtube-mcp.mjs` | 为核对过的上游提交生成独立 OAuth/stdio 入口 |
| `scripts/matrix-browser-status.mjs` | 抖音 Browser MCP 状态与扩展配置提示 |
| `resources/mcp/*.bridge.example.json` | YouTube、抖音采集的配置模板，不含真实凭据 |
| `src/pages/MCPConnections.tsx`、`src/components/MCPPublishDialog.tsx`、`MCPCommentsDialog.tsx` | 五平台配置、账号核对、发布条件与评论导入 |
| `server/topic-performance.mjs`、`research-data.mjs`、`research-routes.mjs`、`research-ai.mjs` | 相关性、时间/指标清洗、同平台比较、引用与分析流程 |
| `src/pages/Research.tsx`、`skills/research-query/SKILL.md`、`skills/research-analysis/SKILL.md` | 话题/读取账号选择、证据展示、AI 观察与假设边界 |
| `src/ui-theme.css` 及页面样式 | 语义颜色与阅读层级，保留原有外观偏好 |

## 必须保持的约束

1. **本地数据兼容**：不重建真实用户保险箱，不移动或清空旧小红书默认登录目录；旧数据无平台字段时沿用原默认值。新账号独立目录、端口和身份，不能用同一 Cookie 文件冒充两个账号。
2. **账号绑定**：发布、评论、研究提交时固定目标账号。抖音 `readEndpoint/readApiKey` 归同一个账号，但主服务和采集服务应登录同一真实平台身份。读取配置与日志不能返回令牌。
3. **发布保护**：保留用户最终确认、预检和防重复提交。TikTok 预检绑定账号/连接并有有效期；提交前重查官方账号身份和发布限制，不信任前端注入的权限选项。
4. **权限与素材**：MCP 有工具不代表账号有权限。海外 OAuth 在官方页面完成；公开素材 URL 必须符合平台约束，不自动传到未知图床。外部 OAuth 文件的保存机制不等同于工作站保险箱。
5. **指标可信**：真实发布日期与采集时间分开；未知不补零，不合成跨平台总分。YouTube 播放与点赞分列，Instagram 标签能力与登录方式相符，TikTok 不伪造评论/全网搜索。
6. **内容可信**：帖子和评论都是待分析数据；AI 不得执行其中指令。分析只能描述样本观察、可能因素与待验证建议，不能把相关性解释为因果。

## 研究流程要点

`researchStatus` 可读取指定账号配置；`researchSearch` 接收 `discovery.platform` 与独立 `accountId`，通过读取服务查询。小红书综合模式双路检索，每个关键词最多 4 次详情、最多 3 个关键词；YouTube 合并相关与高播放候选；Instagram 合并标签热门/近期样本；抖音经采集服务读取详情。

`topic-performance` 在同平台同话题内按一个指标排序，未知另行标记；足够样本才提供中位数参考。无匹配内容或无可比较指标时保存候选并返回说明，不直接产生 AI 分析费用。来源账号信息本地保留，提交给模型前去除。旧网页搜索、引用与 RAG 流程保留。

## 测试与后续验证

- 新适配：`tests/matrix-adapters.test.mjs`、`matrix-stdio-bridge.test.mjs`、`matrix-youtube-setup.test.mjs`。
- 新集成：`tests/matrix-integration.test.mjs`，假保险箱、假 MCP 与隔离 HTTP，覆盖凭据、跨账号拒绝、评论去重、素材限制、TikTok 权限变化和抖音双服务。
- 研究：`tests/topic-performance.test.mjs`、`xhs-discovery-mcp.test.mjs` 及 `research-*.test.mjs`；保留来源、日期、费用、失败后已有内容测试。
- 界面：`tests/appearance.test.mjs`；30 张主页面截图见 `.tools/neutral1190-results`，14 张发布弹窗截图及 15 组行为检查见 `.tools/publishui1190-results/result.json`。覆盖三个海外平台断开、能力未知、无发布工具时禁止最终提交；不作为用户资料打包。
- 上游契约：`.tools/matrix-upstream-smoke/return-contract-results.json` 记录 TikTok/Instagram 真实处理函数的离线验证。使用模拟 API 传输并禁止联网，验证真实返回封装，不代表完成 OAuth 或真实发帖。

构建前运行 `node scripts/compile-copy-skills.mjs`；继续按项目 `check`、`build`、`build:web`、`build:static`、`build:windows` 与 `node scripts/package-windows.mjs` 流程验证。最终次数与包校验以 [验证记录](VALIDATION-1.19.0.md) 为准，不把 mock 成功当作真实发布成功。

下一位开发者先用自有测试账号完成各平台 OAuth 和只读核验，再经明确授权做单条投稿测试。不得为了验证替换现有真实账号文件，或提交 Cookie、OAuth 文件、AI 密钥、素材与用户工作区。

## 配套资料

- [安装、OAuth、固定上游版本与能力边界](MATRIX-MCP-SETUP.md)；打包为 `多平台MCP/README.md`，配套 `scripts` 与 `examples`。
- [同话题研究设计与来源](TOPIC-CONTENT-RESEARCH.md)。
- [界面设计依据与验证](UI-READABILITY-1.19.0.md)。
- [用户升级步骤](UPGRADE-1.19.0.md)。
