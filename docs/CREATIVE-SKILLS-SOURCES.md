# 内置宣传文案 Skills 的研究来源

核对日期：2026-10-14。本文记录内置技能的设计参考，不是第三方安装清单。`marketing-copywriting` 为面向本工作站接口的中文原创规则；`xiaohongshu-copywriting` 保留既有规范并补充参考证据、原创表达和技能边界。没有复制上游脚本或整段技能正文。

## 可借鉴的开源项目

### coreyhaines31/marketingskills

- [项目主页](https://github.com/coreyhaines31/marketingskills)：检索时页面约 53.4k stars、7.9k forks，表明社区关注和复用线索。
- [许可证](https://github.com/coreyhaines31/marketingskills/blob/main/LICENSE)：MIT，版权声明为 Corey Haines。若以后实质复制或改编源码、技能正文，应随分发保留对应版权与许可声明。
- [copywriting](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/SKILL.md)：参考产品背景优先、读者语言、具体收益及证据约束。
- [social](https://github.com/coreyhaines31/marketingskills/blob/main/skills/social/SKILL.md)：参考内容方向、开头与正文衔接、平台适配和内容复用。
- [ad-creative](https://github.com/coreyhaines31/marketingskills/blob/main/skills/ad-creative/SKILL.md)：参考从实际表现、用户评论与外部内容提炼创意；把效果解释转成有指标和比较对象的测试假设。

适配方式：重新撰写中文指令；使用本项目的事实、检索片段和来源标识；保持 `title`、`body`、`prompt`、`scenes` 接口。不直接继承上游的英文风格黑名单、平台限额、未经本项目验证的效果数字或工具推荐。

### autoclaw-cc/xiaohongshu-skills

- [项目主页](https://github.com/autoclaw-cc/xiaohongshu-skills)：检索时约 1.9k stars、239 forks。
- [许可证](https://github.com/autoclaw-cc/xiaohongshu-skills/blob/main/LICENSE)：MIT。
- [xhs-content-ops](https://github.com/autoclaw-cc/xiaohongshu-skills/blob/main/skills/xhs-content-ops/SKILL.md)：包含按一周内及互动排序搜索、详情采样、标题/封面/正文/互动指标对比的流程。

适配方式：借鉴「发现候选—核对详情—比较样本—形成选题」的流程，检索结果仍由工作站清洗并核对时间。仅有搜索排名或高点赞不能证明是近期爆款。不继承其专用 CLI 限制、自动互动行为或未经验证的固定频率与发布时间建议。

## 仅作产品思路参考

[Xiangyu-CAS/xiaohongshu-ops-skill](https://github.com/Xiangyu-CAS/xiaohongshu-ops-skill) 检索时约 2.4k stars、259 forks，展示账号定位、选题、模式库与复盘沉淀的设计。检查时根目录未见许可证，`LICENSE` 原始链接返回 404，不能据此当作已获再分发许可；本工作站不复制其技能正文。其他下游仓库标注 MIT，不足以证明该上游具有相同授权。

## 证据的使用边界

星标、Fork 和作者展示的样本不等于采用技能后提高转化率的证据。本次未发现足以支持此类结论的独立对照实验。因此不宣称这些技能能保证爆款、流量或转化。

本工作站验证应包括：用户选择的技能确实进入生成请求；项目事实及接口格式保持不变；参考来源可追溯；虚构数据不进入成稿；记录实际结果后再比较不同文案。效果总结应区分观察、假设和已验证结论。

[Agent Skills 格式规范](https://agentskills.io/specification) 提供元信息、正文与按需参考文件的结构。内置技能采用 `metadata.version` 保存版本；大词库和参考语料保持独立，不在每次生成时整库注入。
