# v1.17.0 开发交接

更新时间：2026-10-14。适用代码版本：1.17.0；发布状态与附件以对应 GitHub tag / Release 为准。
本文件说明当前实现及接手入口；旧版文档中的“仅手动发布”“12 份 Skills”等口径不可直接沿用。
先读 [本版使用说明](UPGRADE-1.17.0.md)、[本版验证记录](VALIDATION-1.17.0.md)，再查下表对应源码。
若单独下载此文档或在安装包内阅读，请打开 [GitHub 在线版本](https://github.com/JerryCoal/shengzhang-studio/blob/v1.17.0/docs/DEVELOPMENT-HANDOFF-1.17.0.md) 使用下面的源码与文档链接；相对链接以仓库 `docs/` 目录为基准。

## 1. 产品主流程与能力

**项目事实 → 项目语料 → 可选内容研究 → 策略草稿 → 人工确认 → 内容制作 → 发布确认/登记 → 评论复盘 → 采用建议 → 下期策略。**

| 页面 | 当前能力 | 必须保留的边界 |
|---|---|---|
| 项目与品牌 | 维护目标、受众、卖点、已核实事实、渠道与预算；自动保存 | 外部参考不能变成本项目事实 |
| 项目语料库 | TXT/MD/DOCX/文字型 PDF 导入，本地关键词检索；可选 Qwen 混合检索 | 扫描件需先转文字；云向量并非离线功能 |
| 热点与灵感 | 小红书选题与高互动帖子；公开新闻及可选网页搜索 | 样本热度不是全站排名，未知数据不能补零 |
| 策略与 Prompt | 模板或模型生成，可编辑；确认后创建制作任务 | 已确认版本锁定，修改另存新版本 |
| 内容制作 | AI 文案、词库自检、Seedream 封面、首尾帧视频、免费本地模板 | 成品、产品外观与画面文字需人工核对 |
| 发布中心 | MCP 投送、官方页面助手、导出手动发布、作品链接登记 | 排期不触发无人值守发布，结果不明锁定重试 |
| 评论与复盘 | 导入去重、规则/AI 分类、人工校正、带原文依据的复盘 | AI 分类每批最多30条，复盘最多200条；不覆盖人工校正 |
| 运营数据 | 自有作品网页采集/手填，保存播放阅读、点赞、评论、收藏、分享快照 | 每作品只取最新累计快照；不输出 ROI、转化率或因果结论 |
| 下期策划 | 已采用建议和原文依据进入下一轮策略 | 品牌经验是待验证改进，不改写已核实产品参数 |

免费路径可完成项目、模板策略、本地图片/12秒短片、导出、评论导入和规则复盘；AI与外部服务按需配置。
媒体路径：小红书封面为 Seedream 3:4；视频为 GPT Image 2 / Seedream 首尾帧 → 人工确认 → Seedance，支持5/8/12秒。

## 2. 架构与目录索引

前端为 React 19 + TypeScript + Vite；后端为 Node.js + Express 5 + `node:sqlite`，数据输入主要用 Zod 校验。
Windows 外壳为 Electron，主进程通过独立 Node 后端、受限 preload/IPC 与官方平台窗口协作。
`src/api.ts` 根据构建模式选择本机API、纯本地体验API或联网中转API；三种模式的数据边界不同。

| 关注点 | 关键入口 |
|---|---|
| 页面与共享状态 | [App.tsx](../src/App.tsx)、[context.tsx](../src/context.tsx)、[types.ts](../src/types.ts)、[pages](../src/pages/) |
| API与领域操作 | [app.mjs](../server/app.mjs)、[domain.mjs](../server/domain.mjs)、[workflow.mjs](../server/workflow.mjs) |
| Windows启动/账户 | [windows.mjs](../server/windows.mjs)、[profiles.mjs](../server/profiles.mjs)、[desktop/main.cjs](../desktop/main.cjs)、[preload.cjs](../desktop/preload.cjs) |
| 存储与凭证 | [store.mjs](../server/store.mjs)、[crypto-box.mjs](../server/crypto-box.mjs)、[vault.mjs](../server/vault.mjs) |
| 旧单工作区入口 | [index.mjs](../server/index.mjs)；供普通开发/兼容入口使用，不等于按用户加密模式 |
| 静态/联网网页 | [local-api.ts](../src/local-api.ts)、[local-vault.ts](../src/local-vault.ts)、[web-api.ts](../src/web-api.ts)、[web-payload.ts](../src/web-payload.ts)、[web-relay.mjs](../server/web-relay.mjs)、[web-jobs.mjs](../server/web-jobs.mjs) |
| 构建/测试/资源 | [scripts](../scripts/)、[tests](../tests/)、[skills](../skills/)、[resources](../resources/)、[vite.config.ts](../vite.config.ts) |

## 3. 从干净仓库启动

前置：Node **>=22.13.0**；本版实际验证 **Windows x64 + Node 24.19.0 + pnpm 11.25.0**。Windows发行包应继续使用已核验的24.19.0运行时。
仓库有 [pnpm-lock.yaml](../pnpm-lock.yaml) 和 [pnpm-workspace.yaml](../pnpm-workspace.yaml)，**没有 package-lock.json**，不要执行 `npm ci`。
先安装上述 Node 与 pnpm；在仓库根目录执行以下命令。首次安装依赖需要网络，不需要业务API密钥。

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
```

| 命令 | 用途与前置 |
|---|---|
| `pnpm run dev` | Node监视模式 + Vite热更新，前端5173代理后端4318；使用旧单工作区，不要接入个人生产数据 |
| `pnpm run start` | 启动旧单工作区API并提供已构建的 `dist`；读取可选 `.env` |
| `pnpm run start:windows-web` | 按用户加密的本机完整网页，默认4319；先构建 `dist` |
| `pnpm run build` | 编译Skills、TypeScript检查、桌面/本机网页前端到 `dist` |
| `pnpm run build:web` | 联网中转版前端到 `web-dist`；启动前准备 `.env.web.example` 对应配置 |
| `pnpm run start:web` | 启动联网中转后端；必须配置 `WEB_PUBLIC_ORIGIN`，生产使用HTTPS根地址 |
| `pnpm run build:static` | 静态体验版到 `static-site/dist`；不能执行付费模型、MCP或本机OCR |
| `pnpm run test` | 检查Skills产物一致性并运行 `tests/*.test.mjs` |
| `pnpm run check` | 重新编译Skills、TypeScript检查、完整自动测试 |

接手时优先用全新的隔离数据目录启动本机完整网页，避免沿用当前Windows用户的业务空间：

```powershell
$env:STUDIO_DATA_DIR = Join-Path $env:TEMP ('shengzhang-dev-' + [guid]::NewGuid())
pnpm run start:windows-web
```

打开终端输出的本机地址，注册测试用户。该入口没有Electron提供的内置平台窗口；完整MCP/平台窗口体验需启动Windows成品包。
如需普通前端热更新，在独立终端先设置 `$env:DB_PATH = Join-Path $env:TEMP ('studio-dev-' + [guid]::NewGuid() + '.sqlite')`，再执行 `pnpm run dev`。
`vite.config.ts` 的代理固定指向4318，不能把默认4319完整后端直接当成该命令的代理目标。

## 4. Windows构建与分发前置

`build:windows` 是组装脚本，**不会替你构建前端、下载Electron或验证当前Node的官方来源**。
需先从官方发行渠道获取Windows x64 Node 24.19.0及其校验信息，核验后用该Node执行构建；脚本会复制 `process.execPath` 到包内。
另预置官方 `electron-v44.3.0-win32-x64.zip` 到 `.tools/`，对照官方 `SHASUMS256.txt` 验证。
[构建脚本](../scripts/build-windows.mjs) 内置该ZIP的SHA-256：`26bf9a617d58d81772b3d68305d59ee48272969c15083c06db634a77358a8d9d`。
Node官方许可文件准备为 `.tools/node-LICENSE.txt`；脚本会复制它，发布前确认Node、Electron和依赖许可证完整。
这些运行组件与缓存不在源码仓库中；安装依赖也不会自动准备Electron ZIP。

```powershell
pnpm run build
pnpm run build:windows
node scripts/package-windows.mjs
```

结果为 `outputs/windows/Shengzhang-Studio-1.17.0/`、同版本Windows ZIP及 `.sha256`。
从干净版本目录构建；旧输出已存在时脚本可能复用已解压Electron，不可把复用产物当作重新验证官方组件。
包内后端为 `resources/app/backend.cjs`；OCR脚本必须在同目录，Node运行时位于 `resources/runtime/node.exe`。
源码仓库不应包含个人工作区、浏览器缓存、Cookie、凭据、测试输出或安装包；分发ZIP应作为Release附件。
`scripts/package-static-windows.mjs` 是旧 Sites 专用打包器，需额外配置 `STUDIO_SITE_BUILD_HELPER` 和可选 `STUDIO_PYTHON`；它不属于本次标准构建流程，静态版使用 `build:static`。

## 5. 数据、权限与运行模式

| 模式 | 存储/凭证 | 可用边界 |
|---|---|---|
| Electron Windows | 默认 `%LOCALAPPDATA%\ShengzhangStudio`；后端用户数据在其 `data` 子目录 | 完整本机功能、内置平台窗口和OCR；窗口关闭默认缩到托盘 |
| `windows.mjs` 本机网页 | `STUDIO_DATA_DIR`，未指定时使用本机默认目录；只监听回环地址 | 按用户加密工作区；无Electron IPC时不能假定桌面助手存在 |
| `index.mjs` 旧入口 | `DB_PATH` 或 `data/studio.sqlite`；默认工作区JSON未启用按用户加密 | 兼容/开发用途；对外监听要求独立访问密码，不是团队账号系统 |
| 静态体验版 | 浏览器IndexedDB，密码派生AES-GCM密钥 | 无API密钥接收、外部AI/MCP调用；与Windows用户不自动同步 |
| 联网中转网页 | 浏览器加密工作区/凭证；按请求发送必要资料和密钥到中转内存 | 服务端不持久化工作区；仅允许白名单操作，一次一个联网请求；不是完全本地处理 |

Windows用户密码经PBKDF2-SHA256 600,000次派生，HKDF区分工作区与凭证用途；工作区用AES-256-GCM加密。
API密钥另外叠加当前Windows账户DPAPI；模型路由等非秘密配置独立保存。密码无法找回，快捷登录需显式启用。
JSON备份包含明文业务资料和素材，不含API密钥；当前无通用备份导入恢复界面，迁移需另行验证，不能承诺复制密钥跨机器可用。
本地RAG索引、研究库与引用、自装Skills不应上传联网中转；客户端剥离和服务端拒绝逻辑必须同时维护。
不要将密钥放进 `VITE_*`、日志、截图或提交记录；使用示例配置文件，不复制个人 `.env`。
详细边界见 [网页本地数据设计](WEB-LOCAL-DATA.md)；旧文档的版本介绍仅作历史参考。

## 6. 业务模块索引与关键约束

| 模块 | 核心代码/说明 | 接手时注意 |
|---|---|---|
| 模型分工与费用 | [models.mjs](../server/models.mjs)、[ai-routes.mjs](../server/ai-routes.mjs)、[ai.mjs](../server/ai.mjs)、[deepseek.mjs](../server/deepseek.mjs)、[qwen.mjs](../server/qwen.mjs) | 策略/下期/文案/分类/复盘分别选模型；价格目录是估算，修改需核对官方账单口径 |
| 事实与Prompt | [prompts.mjs](../server/prompts.mjs)、[ai-context.mjs](../server/ai-context.mjs)、[提示词说明](PROMPT-WORKFLOW.md) | 已确认简报快照、语料出处、研究引用分开；不能重复拼接整份历史上下文 |
| RAG | [rag.mjs](../server/rag.mjs)、[rag-routes.mjs](../server/rag-routes.mjs)、[qwen-embedding.mjs](../server/qwen-embedding.mjs)、[RAG设计](QWEN-RAG.md) | 北京Qwen向量可选；最多200段/轮，语料变化索引失效，失败回退关键词；向量实验预算每项目1元人民币 |
| Skills | [manifest](../server/ai-skills-manifest.mjs)、[registry](../server/ai-skill-registry.mjs)、[编译脚本](../scripts/compile-copy-skills.mjs)、[规则目录](../skills/)、[设计](AI-SKILLS-WORKFLOW.md) | 14份内置规则覆盖14工作流；不要手改生成产物，自装规则仅普通文案可选、不执行脚本 |
| 敏感词/价格语义 | [sensitive-checker.mjs](../server/sensitive-checker.mjs)、[semantic-replacement.mjs](../server/semantic-replacement.mjs)、[CopyCheckPanel](../src/components/CopyCheckPanel.tsx)、[词库交接](ai_copy_sensitive_checker_handoff.md) | 固定替换→复检→按需AI候选；采用后还需保存；不能保证平台审核，不能擅改金额 |
| 近期内容研究 | [research-routes.mjs](../server/research-routes.mjs)、[research-sources.mjs](../server/research-sources.mjs)、[research-data.mjs](../server/research-data.mjs)、[research-ai.mjs](../server/research-ai.mjs)、[研究说明](RECENT-CONTENT-RESEARCH.md) | 日期/原文证据校验；保留失败前资料；选用参考才进入创作，最多5项 |
| 搜索服务 | [news-crawler.mjs](../server/news-crawler.mjs)、[qwen-search.mjs](../server/qwen-search.mjs)、[research-page-reader.mjs](../server/research-page-reader.mjs) | 免费RSS不等于全网热榜；Qwen联网北京地域；网页搜索/研究向量共用每项目1元人民币预算 |
| 图片/视频 | [seedream-config.mjs](../server/seedream-config.mjs)、[seedream.mjs](../server/seedream.mjs)、[cover-generation.mjs](../server/cover-generation.mjs)、[media-generation.mjs](../server/media-generation.mjs) | 请求预留、实际结算、结果不明锁定；素材不因检查失败被丢弃 |
| 后台文字任务 | [useBackgroundTasks.ts](../src/useBackgroundTasks.ts)、[BackgroundTasks](../src/components/BackgroundTasks.tsx)、[v1.14说明](UPGRADE-1.14.0.md) | 收起不取消；同项目锁防覆盖；Windows可切项目，媒体使用独立状态；未采用候选不保证跨重启恢复 |
| MCP与发布 | [mcp-platforms.mjs](../server/mcp-platforms.mjs)、[mcp-client.mjs](../server/mcp-client.mjs)、[platform-delivery.mjs](../server/platform-delivery.mjs)、[桌面启动器](../desktop/mcp-launcher.cjs)、[内置MCP](../desktop/mcp-server.cjs) | 工具连接、平台登录、账号权限分开；结果不明不得自动重投 |
| 评论/运营数据 | [comment-analysis.mjs](../server/comment-analysis.mjs)、[comment-import.mjs](../server/comment-import.mjs)、[operating-data.mjs](../server/operating-data.mjs)、[平台采集](../desktop/platform-data.cjs) | 原文/作品归属/人工校正/采集时间保留；未知不补零，累计快照不叠加 |
| 飞书计划 | [feishu.mjs](../server/feishu.mjs)、[feishu-sync.mjs](../server/feishu-sync.mjs)、[配置指南](FEISHU-SETUP.md) | 自建应用+多维表格；工作站单向同步计划，冲突暂停；不触发平台发布 |
| 外观与保存 | [appearance.tsx](../src/appearance.tsx)、[appearance.mjs](../server/appearance.mjs)、[useProjectAutosave.ts](../src/useProjectAutosave.ts) | 字号/重点阅读不修改正文；按用户保存，慢响应不得覆盖新输入 |

文字模型当前可选OpenAI、DeepSeek、Qwen；Qwen文字连接可选官方地域，但向量与联网搜索目前仅北京。
小红书新模式直接用最多3个关键词搜索、最多12篇详情，本地清洗后DeepSeek分析最多10条；无需额外向量/搜索密钥。
30天范围先请求MCP半年内候选再按真实日期过滤；无合格来源不调用分析，重分析不重复采集但仍可能计费。

## 7. 平台连接与发布边界

- 内置小红书/抖音页面助手由Electron随启动提供，使用官方页面；登录、验证码及额外平台选项由用户完成。
- 外部小红书适配 `xpzouying/xiaohongshu-mcp` v2.5.5，外部抖音适配 `panwenda/douyin-publish-mcp` v0.3.6；主程序与浏览器依赖不随工作站源码或安装包提供。
- 用户从可信上游下载后由启动器选择启动；已有服务也可手工填写本机HTTP `/mcp` 地址，访问令牌不是模型Key或Cookie。
- 小红书研究搜索依赖外部MCP；内置助手不提供搜索。外部抖音当前无评论工具，需切回内置助手。
- 评论与指标采集仅处理用户确认的自有作品；带 `xsec_token` 的完整链接仅用于必要调用，保存链接应剥离凭据。
- 内置助手最终提交需再次确认；外部MCP在工作站明确确认后直接执行。不要将“服务已连接”显示成“发布成功”。
- 平台操作不保证全量评论或长期页面稳定；真实发布未完成本轮验收，导出/手动导入路径必须保留。
- 第三方服务登录文件自行管理，不属于工作站API密钥保险箱；不同工作台用户需要独立目录、端口和登录状态。

## 8. v1.17水印与本机OCR

默认配置 `seedream.watermark` 缺失时取 `true`；封面/关键帧请求可临时覆盖布尔值，不修改默认设置。
Seedream官方图片请求精确传递该字段；OpenAI图片拒绝误传此开关，Seedance视频保持原有 `watermark: true`。
[检查包装器](../server/image-generation-review.mjs) 隔离检查异常；图片原字节保留，模型费用照常结算，不自动重试收费请求。
[OCR模块](../server/image-watermark-check.mjs) 调用 [PowerShell脚本](../server/image-watermark-check.ps1)，只使用Windows 5.1/WinRT中文OCR，不外发图片。
返回 `detected / not_detected / unavailable`、检查时间、归一化矩形与提示；全图识别后只匹配边缘紧凑独立标签。
约束：20 MB、8192像素边长、24M像素；默认20秒超时；随机系统临时目录，正常成功/失败后清理；缺中文组件或空识别结果明确不可判定。
前端 [ImageWatermarkReview](../src/components/ImageWatermarkReview.tsx) 放大原图并覆盖定位框，框不写入图片；“未发现”不代表无水印、无隐式标识或非AI内容。
**检查记录仅随当前封面生成/当前首尾帧保存**：新请求替换 `aiCover`，重做关键帧替换对应帧；历史成品不构成所有OCR记录的永久审计链。
成品包需复制PS脚本到后端同目录；`windowsHide: true` 隐藏启动，不添加已知会在当前宿主卡住的 `-WindowStyle Hidden` 参数。

## 9. 验收、已知限制与后续优先项

本版 [验证记录](VALIDATION-1.17.0.md)：**534项自动测试通过、0失败、0跳过**；类型/Skills一致性及桌面、网页、静态构建通过。
Windows包3次隔离启动、77次本机请求通过；合成图片经模拟生成接口和包内真实OCR识别，PNG哈希不变，采用后重启保留，双用户隔离通过。
界面10组宽窄/最大字号布局检查及3项组件测试通过；这是隔离界面验证，不代表真实付费接口或账号效果验收。
真实外部历史证据：v1.7.1小红书扫码与11条自有评论去重；v1.13公开RSS/网页读取；最新选题研究仍是模拟MCP/DeepSeek验证。
完整复现需Windows、中文OCR和Python3；先设置 `$env:STUDIO_TEST_PYTHON = (Get-Command python).Source` 再运行 `pnpm run check`。
非Windows或未配置Python/中文OCR时，相关测试会跳过；不能将这种结果写成“534项全部实际执行”。

| 优先级 | 下一步 | 验收依据 |
|---|---|---|
| 1 | 隔离小样本真实Seedream/DeepSeek/Qwen生成与检索、真实MCP选题联调 | 原图/原文、请求与账单、召回样例、失败恢复；不要从模拟响应推断质量 |
| 1 | 真实账号草稿与最终发布、飞书当前环境授权联调 | 每次明确确认具体账号/作品，回执可核验，异常不重复提交 |
| 2 | OCR低对比/小字/真实服务商标签测试集 | 合法非敏感样本，误报漏报记录；始终保留人工核对 |
| 2 | 同口径业务试点与数据积累 | 改稿耗时、返工率、发布成功率、固定周期表现，不预设增长结论 |
| 3 | 数据恢复、历史检查记录与跨设备需求 | 先定义恢复范围/凭证迁移/版本保留，再设计迁移测试；现状无跨设备自动同步 |

## 10. 回归与版本更新清单

- 保持用户隔离、加密重启、DPAPI、退出清理、备份排除密钥；测试使用临时目录或内存库，不读取真实用户目录。
- 检查布尔值与旧字段默认、预算不足拒绝、超时不重试、结果不明保留费用；检查故障不得丢弃已付费图片。
- 覆盖同项目重复提交、跨项目编辑、旧响应不覆盖新输入、候选失效、人工采用后保存与发布锁定。
- 保持原文引用、日期、缺失/零/约数、人工分类、词库UTF-16位置、图片字节和语料索引失效规则。
- 平台回环地址/官方域名限制、服务能力发现、取消选择、账号切换清理、外部进程归属和发布最终确认均需回归。
- 更新 [package.json](../package.json)、各health/settings版本及Windows构建/打包脚本中的版本；新增对应使用、发布、验证文档，不能只改EXE名。
- 重新构建前端和三种分发模式，验证Windows包内启动、OCR脚本、14份Skills、许可证、ZIP完整性与SHA-256；发布包排除缓存/凭据/业务数据。
- 用户升级前保存结果并从托盘“退出并停止后台任务”，完整解压新版到新目录；沿用原本本地用户，不删除用户数据，不只替换单个EXE。
- 发布源码与Release附件分开；不要链接未入库的本机验证脚本作为接手必需依赖，也不要把历史测试数字当作新版本验收。
