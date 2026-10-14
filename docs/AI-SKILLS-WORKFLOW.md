# 全流程 AI Skills：使用、来源与维护

核对日期：2026-10-14。本文对应 v1.11.0 本地测试版，共 14 份内置 Skills。

## 实际执行方式

用户输入与已确认资料 → 本地筛选相关资料及去重 → 按步骤加载内置规则 → 当前配置的模型生成 → 结构、引用、版本和词库检查 → 用户核对结果。

规则文件负责长期稳定的判断与表达要求。字段定义、预算、请求权限、输出校验、原文引用检查、并发锁和本地存储仍由程序控制。Skills 不执行代码、不会自行打开网页，也不把模型说出的“已经完成”当作实际操作回执。

| 场景 | 自动规则 | 主要要求 |
| --- | --- | --- |
| 近期检索方向 | research-query | 根据项目生成至多 3 个查询，不虚构来源与热点 |
| 近期参考分析 | research-analysis | 只用已检索证据，观察与假设分开，缺失指标不补零 |
| 策略规划 | marketing-strategy | 一个主要受众、场景、目标与有据可查的主张 |
| 下期策划 | iteration-planning | 已采纳反馈 → 待验证假设 → 一项主要改动 |
| 小红书文案 | marketing-copywriting + xiaohongshu-copywriting | 事实、自然表达、正文与画面说明分离 |
| 抖音文案 | marketing-copywriting + douyin-copywriting | 开场、展示、行动引导与三个分镜 |
| 敏感词改写 | sensitive-copy-review | 本地固定替换后，仅修订仍需改写部分并复检 |
| 价格语义判断 | price-context-replacement | 逐处分类，本地执行用户配置的替换 |
| 评论分类 | comment-classification | 不漏 ID、真实连续原文证据、模糊项待核对 |
| 评论复盘 | comment-insight-analysis | 观察与建议分开，不将咨询推断为成交 |
| 小红书封面 | cover-art-direction | 单一视觉重点、明确构图与文字模式 |
| 视频首帧 | keyframe-continuity | 清晰的开场静止状态 |
| 视频尾帧 | keyframe-continuity | 参考首帧、保留产品和场景连续性 |
| 视频生成 | seedance-motion | 在实际时长和声音设置内完成端点间动作 |

普通文案可叠加一份适用的用户 Skills；其余步骤使用内置规则。用户自装文本不进入审核或媒体流程。联网网页仍不向远程后端发送用户自装规则，Windows 本地应用可按原有选择生成。

## 调研取舍

- [阿里云提示词模板](https://help.aliyun.com/zh/model-studio/prompt-template)：借鉴固定模板与动态输入分离、集中维护。本项目使用本地 Markdown 编译，不新增云端模板存储。
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 与 [Qwen 结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)：保留 JSON 要求、类型正确的格式示例与应用侧校验。合法 JSON 不等于事实正确、引用完整或满足业务结构；未擅自替换已有模型或取消输出预算。
- 策略、迭代和短视频借鉴开源营销项目及平台官方创意原则，具体链接、许可与适配见 [文字规则来源](AI-SKILLS-TEXT-SOURCES.md)。原有小红书与通用写作规则见 [文案规则来源](CREATIVE-SKILLS-SOURCES.md)。社区反馈只能用于选取参考，不能证明本项目增长效果。
- 评论分析参考原文证据、情绪对象与依据评估实践，见 [评论规则来源](AI-SKILLS-ANALYSIS-SOURCES.md)。不接入其他分析服务，不新增付费分析环节。
- 媒体规则依据火山官方提示词与调用指导，见 [媒体规则来源](AI-SKILLS-MEDIA-SOURCES.md)。每次只加入当前步骤规则，明确实际参考顺序、时长和声音。中文提示词简洁建议不是硬限制，不为满足字数擅自删除重要约束。

## 为什么可能更省时间与额度

旧策略对象包含派生任务、重复 Prompt、旧检查结果等；现在只提交本轮真正用到的历史策略字段。普通文案请求保留完整策略，并去掉任务中完全相同的前缀。Qwen 不再向已经生成的策略再次附加语料。少传重复内容是可检查的变化；真实 token、耗时和质量仍需同模型同资料对照。

每个场景只加载一至两份内置规则，不载入整个规则目录。大词库先由本地程序扫描；已安装但未选择的规则、其他用户资料及旧规则快照不进入请求。没有增加“规划→反思→重写”的自动调用循环，失败保留内容与用量记录，由用户决定下一步。

## 如何继续维护

1. 编辑 `skills/<名称>/SKILL.md`，更新 `metadata.version`。只写该步骤稳定规则，业务数据和大词库另存。
2. 新增场景时修改 `server/ai-skills-manifest.mjs` 与 `server/ai-skill-registry.mjs`；设置目录与实际路由共用此注册表。
3. 运行 `node scripts/compile-copy-skills.mjs`，同时更新内置正文和版本；`--check` 可发现未编译文件。
4. 用固定输入测试 JSON 结构、证据 ID、原文片段、版本冲突和用户隔离；再做真实模型的小批量人工评价。不要以模拟响应宣称文案更好。
5. 将有代表性的失败输入加入回归，记录错误类型和规则版本；不要把客户原始资料或密钥写进公共测试。

近期内容研究已接入真实来源适配、清洗、检索和分析接口，详见[工作流程与边界](RECENT-CONTENT-RESEARCH.md)。研究会增加一次检索方向生成和一次参考分析；仅重新分析时跳过前者和采集。新接口经过模拟测试，实际付费服务和账号组合仍需用户配置后验证。
