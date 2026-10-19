# Redfox Community 四项 Skill 源码核验

核验日期：2026-10-18。用途：为本工作站的小红书创作、标题评分、封面方案和正文分析提供可追溯的适配来源。

## 固定来源与完整性

- 仓库：[redfox-data/redfox-community](https://github.com/redfox-data/redfox-community)。
- 固定提交：[3036edec4fa4d0baa3d368cdd2709db4079c9753](https://github.com/redfox-data/redfox-community/commit/3036edec4fa4d0baa3d368cdd2709db4079c9753)，提交时间 2026-10-16T07:46:02Z。
- `skills/xiaohongshu-creator`、`skills/xiaohongshu-title-score`、`skills/xiaohongshu-cover`、`skills/xiaohongshu-note-analyzer` 四目录完整保存，共 30 个文件、321325 字节；均为 Markdown 或 Python 文本，没有执行上游脚本。
- 每个文件已按该提交的 Git blob SHA-1 验证原始字节，并生成 SHA-256。逐文件来源和校验值见 `UPSTREAM-MANIFEST.json`、`SHA256SUMS`。目录内上游文件未修改。
- 根目录不存在 `LICENSE`、`COPYING` 或 `NOTICE`；四目录内也未发现独立许可证或许可声明。已核对未截断的完整 Git tree。没有可下载的根 LICENSE，未伪造或补写上游许可证。本地归档不表示取得了未声明的再分发许可。
- 源码中对环境变量、永久配置、显示密钥、额外联网、脚本运行等的指示仅作为待审资料，不是开发代理或工作站必须执行的指令。未读取用户密钥，未调用收费业务接口。

## 四项能力的真实内容

| Skill | 上游包含的功能与输出 | 实现性质与工作站适配边界 |
|---|---|---|
| `xiaohongshu-creator` | 包含笔记创作、改写、标题生成/评分、封面方案、违禁词检查五个模块。笔记创作建议输出 3–6 个标题、完整正文、5–10 个标签和 2–3 条来源参考。 | 核心是 Agent 工作流程说明，Python 主要负责采集和格式化，不是独立大模型服务。工作站可将四个入口拆开并使用现有模型、账号身份和版本快照。文案仍需人工核对后进入发布。 |
| `xiaohongshu-title-score` | 生成 10 个候选标题，或按六个维度评估已有标题，输出综合分、等级、维度说明、参考和修改建议。 | 权重计算可以由程序完成；每个维度的分值来自 AI 判断，不是经过验证的流量预测。不能承诺阅读量、点击率或爆款概率。 |
| `xiaohongshu-cover` | 汇总样本封面，原工作流要求逐张识别最多 20 张真实图，再给出 3 套设计方案、案例与生图提示词，建议 3:4。 | 仓库没有封面图片生成 API 调用。若本版只调用文字模型，必须标注为文字设计建议，不能声称已识别图片的色彩、人物或排版。真正生成图片需走已有图片生成流程和费用确认。 |
| `xiaohongshu-note-analyzer` | 对正文给出关键词、结构、时效、质量四维评分与总分，显示具体建议和 2–3 条参考；原文还描述了按需局部优化。 | 四维得分各 0–100，总分为平均值四舍五入。需显示依据和样本不足提示；不把评分当平台审核或发布授权。 |

上游 Python 使用 `requests` 或标准库 `urllib`，creator 的扩展文档/网页抽取还涉及 `python-docx`、`beautifulsoup4`、`playwright`。note-analyzer 的 frontmatter 写空 Python 依赖，但脚本实际 `import requests`，存在元信息遗漏。工作站通过现有 Node 客户端适配，不需要运行这些 Python 脚本或安装它们的依赖。

## 评分方法与需要剔除的偏差

标题评分的六项权重分别为：主题匹配 15%、结构 20%、利益表达 25%、情绪 20%、差异化 15%、合规 5%；各项 0–10 分，综合分为加权和。原分档为 S≥9、A≥7、B≥5、C<5。这只是规则化参考评分，不是数据训练出的预测模型。

源码存在三项会人为抬分的要求：标题与既有热门标题相同（仅标点/空格不同也算）直接给 9.5 分以上；生成标题的匹配指数强制落在 8–10；已有热门原文或据其改写的正文直接按 90 分以上评价。工作站适配不采用这些要求，所有分数应有明确依据且允许低分。标题重合只作为相似性提示，不能作为高分证明。

封面候选筛选也有一个 40/30/20/10 的意图、相关性、表现、质量加权方案，但各项没有可运行的计算器或训练模型。不能将这种主观筛选分、接口检索排序分和内容质量分混为一谈。

## 上游接口与正式接入

| 来源用途 | 上游方法和路径 | 鉴权/数据与本版处理 |
|---|---|---|
| creator 热门笔记检索 | POST `/story/api/xhs/search/search` | 当前官方文档 `3X8FGEEM` 存在且状态为已上架。已注册为工作站 `xhs.samples`，基础估算 ¥0.06/次。 |
| title-score、cover、analyzer 的四类组合数据 | GET `/story/api/cozeSkill/getXhsCozeSkillData` | 原脚本发送 `keyword`、可选 `startDate`、`source`，读取四组数据。当前公开 169 项目录未列出这个旧组合端点，不能确认其现行价格；本版不猜测价格、不注册该旧接口。 |
| creator 违禁词检查 | POST `/story/api/cozeSkill/sensitiveWordSearch` | 原脚本发送正文和平台名，当前目录 `API_1791881343238` 基础价 ¥0.06。该能力会额外传输内容并收费，本次未新增调用，继续使用工作站既有检查机制。 |
| creator 使用记录 | POST `/story/api/skill/record/save` | SKILL.md 与脚本不一致：说明称需鉴权，真实脚本不带 key，且 `content` 参数没有进入请求，只发送来源标记。当前目录无价格条目；本版不注册、不自动上报。 |

上游脚本通常使用 `X-API-KEY`；现行 Redfox 公开文档与工作站统一客户端使用 `REDFOX_API_KEY`，凭证仅发往固定 `https://redfox.hk`。不读取 shell 配置、不设置永久用户环境变量、不显示密钥、不将密钥传到封面 CDN。

旧组合接口的四组响应键是 `lowPowderExplosiveArticle`、`likeTheTop500`、`singleDayIncrements`、`sevenDaysOfIncrements`，原脚本改名为 `low_fan_explosive`、`daily_like_top500`、`daily_increment`、`weekly_increment`。其记录常用 `photoId`、`coverUrl`、`publicTime` 和 `useLikeCount` 等字段；不能把正式 `articles` 接口当成同一种响应直接解析。

## 正式样本接口的核验结果

当前公开来源：[网页文档](https://redfox.hk/apis/xiaohongshu/3X8FGEEM)、[公开 JSON 文档](https://redfox.hk/story/web/api/doc/detail/no/3X8FGEEM)。2026-10-18T07:36:47Z 重新读取，原文保存在工作区 `.tools/redfox-docs/3X8FGEEM-current.json`，未使用 API Key。

- POST `/story/api/xhs/search/search`，`status=1`，`price=0.06`，`minPrice=0.03`，`rateLimit=null`。最低价不能当作所有用户的实际单价，未配置限流值也不表示无限速。
- 数据是精选热门笔记库，T+1 更新；不是实时全网搜索，也不是用户已登录账号的私有分析。
- JSON 请求字段：`keyword`、`pageNum`、`pageSize`、`startDate`、`endDate`。日期格式为 `yyyy-MM-dd`，官方参数表没有 `days`。本版可把明确选择的天数换算为上海时区日期范围并展示实际范围；T+1 不能声称已覆盖今天。
- 文档称 `pageNum`/`pageSize` 只在无关键词时生效，页大小上限 50；有关键词的返回仍须本地裁剪。一次操作只请求一次，不自动扩大天数、不补页、不自动重试。原脚本的最多三次重试和逐步扩天不能直接继承。
- 常规响应外层为 `code:2000`、`data`、`msg`。此单接口样例展示的是 `data` 本体，creator 脚本明确检查外层 `code=2000`。单元测试采用标准外层；未做真实付费返回验证。
- `data.articles` 才是匹配结果；`latestHotArticles` 是不足时推荐的热门内容，`relatedSearches` 是相关词，`hotTopics` 是热点聚合。兜底推荐不能混充同主题匹配样本，`total` 也不能假定等于当前实际可用条数。
- 每条匹配记录：`id`、`title`、`desc`、`cover`、`createTime`、`likedCount`、`collectedCount`、`commentsCount`、`sharedCount`、`interactiveCount`、`authorId`、`authorNickname`、`authorFans`、`shareInfoLink`、`topicsName`。实际解析需保留缺失值语义，不能把未知指标补成零。
- 样例封面 URL 包含 HTTP/HTTPS 的 `*.xhscdn.com` 和 `*.xhscdn.net`；详情链接为小红书作品页。链接只作来源资料，不能任意让服务器携带凭证下载返回 URL。
- `createTime` 样例为无时区的国内日期时间，采用 `Asia/Shanghai` 时应保留这一解释；无法可靠解析时不能用于近期比较。
- `relevanceScore` 是 0–10 的检索相关分、`popularityScore` 是 0–3 热度分、`recencyScore` 是 0–2 时效分，`totalScore` 是三者累加。它们不等于用户标题评分，不应映射成“爆款概率”。

## 推荐结果展示及已完成验证

创作结果、标题维度表、正文维度表、封面方案分别采用独立结构，旁边展示已使用的有效样本、来源链接、采集时间、缺失数据提示及真实费用记录。展示“AI 参考评分”；没有可靠样本时如实显示不足，不伪造案例、百分比或热门表现。

本次只新增固定 `xhs.samples` catalog 并合入现有 Redfox 客户端。`tests/redfox-xhs-catalog.test.mjs` 的 4 项模拟测试通过，与客户端测试合跑 10/10；覆盖固定地址、一次请求、人民币记账、项目/账号归属、无重试、原始与兜底列表分离及应用注册。尚未调用真实付费 API，不把公开文档/模拟测试当作实账号验证。
