# v1.28.0 开发交接

## 来源与适配

四个用户指定地址均属于 redfox-data/redfox-community 同一仓库。固定提交为 3036edec4fa4d0baa3d368cdd2709db4079c9753；vendor/redfox-community/skills 保留四个目录全部 30 个文件，清单含 Git blob 与 SHA-256。SOURCE-REVIEW.md 记录接口差异、许可证检索和脚本行为。

工作站执行的是 skills/redfox-xiaohongshu-* 下的四份适配规则，经 compile-copy-skills 编入默认目录。规则可在原有默认编辑器修改；新增工作流程 xhs-creator、xhs-title-score、xhs-cover、xhs-note-analyzer。只有小红书账号能保存这些工作流程的账号创作方案。

上游 rewrite_record.py 当前发送的是来源标签使用事件，不发送改写正文。本版不执行它，也未注册自动遥测。旧三份脚本的合并数据端点缺少当前价格依据，本版统一使用现有文档明确的 3X8FGEEM 搜索接口，不沿用旧端点或自动扩大搜索区间。

## 服务与状态

server/xhs-assistant.mjs 定义模式、输入输出验证、引用检查、分数计算与样本归一化；server/xhs-assistant-routes.mjs 挂载项目级 /xhs-assistant 状态、samples、estimate、runs、adopt。server/redfox-xhs-catalog.mjs 通过固定 xhs.samples 操作接入 Redfox 客户端。

样本读取一次请求，基础预留 ¥0.06，独立保留结果和费用。生成请求按模式使用 copy 或 analysis 的当前模型路由；不会调用三家进行重复生成。requestId 及输入指纹用于重复提交检查；任务占用共享活动锁，保留完成、失败或中断不明状态，拒绝静默重试计费。

project.xhsAssistant 保存有界样本与运行历史。运行冻结账号、身份修订、目标资产版本和有效 Skills。采纳读取服务端已保存结果，并通过 domain.updateAsset 完成版本检查与现有用词审查。标题采纳只改标题；诊断报告不直接写正文；封面方案保存在 asset.xhsCoverPlan，只有 appliedRevision 与成品当前版本一致才预填 CoverDialog。

样本最多十批、结果最多二十批；另有最多 2000 条持久请求指纹，防止旧结果滚出历史后重复收费。达到上限在记录与外呼之前拒绝，可新建项目继续；不自动清空防重放记录。/runs 的 expectedModel 与 maxReservationUsd 将费用确认绑定至所选型号和上限，变化时返回 409 重新估算。封面采纳同时为成品写入账号 creationTrace，切换账号后既有封面生成归属检查继续生效。

标题六维权重依次为 15/20/25/20/15/5，总分在本机计算，S≥9、A≥7、B≥5，其余 C。正文四维各 0–100，取平均并四舍五入；90/80/60 的等级阈值是工作站展示约定，不冒称上游或平台标准。引用必须是已保存样本 ID，引用文字必须出现在样本内，来源链接由本机补齐。

## 图片理解与隐私

用户授权公开参考封面发送给已有 OpenAI、DeepSeek、千问服务，实际只调用当前支持的所选型号。现有 GPT-5.4 系列通过 Responses input_image，DeepSeek Flash 通过 Chat Completions image_url；Qwen Plus/Flash 与 DeepSeek V4 Pro 暂不开放看图。最多十张，只接收公开 HTTPS 小红书 CDN 来源，无鉴权信息、非标准端口或私网地址。不下载图片到服务端，不向不支持的型号伪装图片输入。

OpenAI 每张 25,000 输入 token 是本地保守预留，非官方固定收费；DeepSeek 每张按官方 1,024 token 上限预留。实际有效 usage 用原 tokenCost 结算，缺少 usage 时保留估算标记。看图由用户开启并在请求前确认预算。

独立网页中转的隐私剥离增加 xhsAssistant、xhsCoverPlan。合并网页状态时保留同项目的本地助手历史，封面方案只在成品 ID、版本、标题与正文一致时恢复。团队浏览器连接本地团队主机不受独立网页中转限制。

官方能力核对（2026-10-18）：
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://api-docs.deepseek.com/guides/vision/
- https://help.aliyun.com/zh/model-studio/vision-model
- https://help.aliyun.com/zh/model-studio/text-generation-model
- https://redfox.hk/apis/xiaohongshu/3X8FGEEM

## 构建与检查

版本统一为 1.28.0。个人版包含开发交接 Skills 和原始来源，团队版也携带 Skills 与来源目录。构建与回归、浏览器实测、程序包检查详见 VALIDATION-1.28.0.md。没有使用真实 API 密钥进行付费联调，不将模拟验证描述为供应商线上验证。
