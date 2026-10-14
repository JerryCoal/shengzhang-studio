# 策略、下期策划与抖音文案 Skills：研究与接口记录

核对日期：2026-10-14。三份内置技能为针对工作站的中文原创规则，版本 `2026.10.14.2`，保存在 `metadata.version`。没有安装第三方技能、运行其脚本或新增自动采集与付费调用。

## 已核对的来源与取舍

| 一手来源 | 参考内容 | 在本工作站的处理 |
| --- | --- | --- |
| [marketingskills：product-marketing](https://github.com/coreyhaines31/marketingskills/blob/main/skills/product-marketing/SKILL.md) | 写作前建立产品、受众、场景和定位背景，复用已经确认的信息 | 直接使用现有项目简报与检索片段，不新增上游 `.agents/product-marketing.md` 工作流，不要求模型读工作区文件 |
| [marketingskills：content-strategy](https://github.com/coreyhaines31/marketingskills/blob/main/skills/content-strategy/SKILL.md) | 内容主题连接业务目标、客户问题和可用资源 | 每轮聚焦一个主张与可执行方向，不照搬以英文 SEO 为主的渠道排序 |
| [marketingskills：ab-testing](https://github.com/coreyhaines31/marketingskills/blob/main/skills/ab-testing/SKILL.md) | 从观察形成假设，控制主要变量，明确指标与比较条件 | 下期策划优先小步修改；没有曝光、成交和成本数据时不计算转化或 ROI，不将评论观察冒充严格随机实验 |
| [TikTok for Business：Creative Codes](https://ads.tiktok.com/business/en-US/creative-codes) | 短视频的开场、价值展示与结束引导；竖屏与界面安全空间 | 仅借鉴一般短视频叙事与画面原则。TikTok 与国内抖音是不同平台，不把前者建议、广告实验数字或规则当作抖音算法结论 |
| [巨量帮助：广告创建与投放](https://support.oceanengine.com/support/content/130495) | 广告创意涉及素材审核、广告计划和投放过程 | 生成宣传文案不等于完成审核或投放；技能不承诺推荐量或投放效果，不触发任何投放动作 |

`coreyhaines31/marketingskills` 的 [原仓库许可证](https://github.com/coreyhaines31/marketingskills/blob/main/LICENSE) 为 MIT。若后续实质复制或改编其正文，应随分发保留相应版权与许可声明；本次仅提炼原则并重新编写。TikTok 与巨量帮助页面属于官方指导资料，未当作开源技能或再分发授权，不复制整段内容。

仓库关注、Fork、作者案例与平台建议都不等于本工作站的效果证明。本次不依据星标宣布这些规则能够提高转化，不把上游示例中的增长比例写入项目事实。既有通用宣传与小红书技能的来源另见 [创作 Skills 来源说明](CREATIVE-SKILLS-SOURCES.md)。

## 与现有接口对应

| 技能 | 当前输入 | 输出约束 |
| --- | --- | --- |
| `marketing-strategy` | `brief`、`instruction`、`corpusReferences`、历史策略与反馈 | 仅 `title`、`core`、`direction`、`prompt`，均为非空字符串 |
| `iteration-planning` | 相同字段，重点使用上期策略和已采纳 `feedback.text/evidence` | 保持上述四字段；将改动、假设和验证方法放进现有字段，不新增实验结构 |
| `douyin-copywriting` | 已确认 `strategy`、`task`、项目简报、要求、检索片段和可选创作技能 | 仅 `title`、`body`、`prompt`、`scenes`；`scenes` 必须是三个字符串 |

对应检查基于 `server/ai.mjs`、`server/ai-routes.mjs`、`server/domain.mjs` 和 `server/prompts.mjs`。下期反馈当前只提供文本及证据片段，不保证有评论 ID；因此不要求模型凭空输出 ID。历史策略可能尚未确认，技能不会将草稿视为已执行方案。普通文案与敏感词修订、价格语义分类是不同调用，不应混用输出结构。

## 验证重点

- 已有事实不足时保留已知信息，在允许字段内说明必要缺口；不编造价格、案例、新闻或统计。
- 反馈不足或矛盾时给待验证的小步建议，不宣布因果、实验胜出或收益提升。
- 抖音发布正文不含制作说明，静态首尾画面与连续动作分别表达，始终保留三个分镜。
- 接线后应验证选中阶段确实加载对应技能，且原有 JSON 校验、预算与复检流程仍生效。文件格式检查不能代替真实生成效果验证。
