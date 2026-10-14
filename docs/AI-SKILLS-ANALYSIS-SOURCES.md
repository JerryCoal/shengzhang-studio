# 评论分类与复盘 Skills：设计依据与接入边界

调研日期：2026-10-14。规则版本：`2026.10.14.2`。

本文记录两份工作站内置规则的设计依据：`skills/comment-classification/SKILL.md` 与 `skills/comment-insight-analysis/SKILL.md`。以下是对官方实践的适配，不是接入其模型服务，也不代表模型效果已经通过真实业务评测。

## 官方资料与采用方式

| 官方资料 | 借鉴的原则 | 本项目中的适配 |
| --- | --- | --- |
| [Microsoft：Sentiment analysis and Opinion Mining](https://learn.microsoft.com/en-us/azure/ai-services/language-service/sentiment-opinion-mining/how-to/call-api) | 区分整段情绪与具体评价对象；一句评论可能同时包含肯定和批评。 | 主题与情绪分别判断；询价不自动等于负面。现有枚举没有 mixed，混合或难以判断时暂记 neutral，并提示人工核对。这是本项目的保守映射，不是宣称 neutral 等于没有情绪。 |
| [Anthropic：Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | 使用 JSON Schema 约束可解析结构，并保留应用端校验。 | 规则文件负责判断边界，`server/ai.mjs` 保留字段、枚举与验证。引用使用应用自己的评论 ID 和原文片段；结构正确仍不等于语义正确。未新增 Claude 接口。 |
| [Microsoft：RAG evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators) | 分开评估检索质量、回答依据、相关性与完整性。 | 评论复盘先检查引用是否存在，再检查结论是否被原文支持；评测还应检查是否遗漏关键反例。现有 ID 校验只能证明引用存在，不能代替语义依据评测。 |

## 与现有程序的职责划分

- `server/comment-analysis.mjs`：主题定义、本地规则初筛、筛选范围和人工校正保护；主题计数由程序计算，一条评论可有多个主题。
- `server/ai-routes.mjs`：分类只提交当前范围内尚未人工校正且未完成 AI 分类的记录；复盘只提交所选有效评论，并记录样本范围。分类单次最多 30 条、复盘最多 200 条。
- `server/ai.mjs`：分类输出每个输入 ID 必须恰好一次，证据必须是对应原文连续片段；复盘输出 1—6 条，每条引用必须属于输入评论。API 验证与使用额度保护不应迁入 Skills。
- 两份 Skills：只保存长期稳定的分类、证据、歧义和小样本判断规则。分类名称解释由程序运行时提供，避免两份定义漂移；不重复粘贴完整 JSON Schema、大词库或全部历史。

当前语料查询是本地关键词检索；评论分析直接读取本次选定评论。这两份规则不会自行联网、爬取热点或调用向量检索。更全面的热点搜索、清洗与检索增强仍需独立实现和验收。

## 建议的离线评测集与验收方法

以下是后续评测要求，不是已完成的效果报告。选取人工标注样本并固定输入，至少覆盖：

1. 普通询价与真实价格批评；明确否定与含混反讽；正负混合；只有 Emoji 或平台表情；仅询问入口而未成交。
2. 多主题、重复文本但不同 ID、超长评论、评论内伪装指令；证据保留原始 Unicode 字符，禁止模型拼接片段。
3. 人工修正记录不被分类覆盖，复盘尊重修正且保留相反意见；示例评论不被当作真实用户反馈。
4. 仅一条或不足 30 条评论时保留小样本表述；证据不足时缩小结论，禁止外推用户画像、销量和因果。

确定性检查应验证字段、合法 ID、ID 覆盖率、原文片段和无额外字段；人工评测分别记录主题、情绪、依据是否支持结论、建议是否可验证以及关键反例是否遗漏。不要用“待核对比例”冒充分类准确率。将来加入检索后，再独立标注检索命中与遗漏，避免把检索问题归咎于写作规则。
