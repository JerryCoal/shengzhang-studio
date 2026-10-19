# GLM 官方文字模型接入

适用版本：Shengzhang Studio 自媒体运营工作站 v2.0.0 · JCoal 开发。文档核对日期：2026-10-19。

## 配置与使用

1. 在[智谱控制台](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)创建“模型标准 API”密钥。请不要使用 GLM Coding Plan 专用密钥、临时令牌或其他平台的密钥。
2. 打开工作站“连接与设置 → 文字模型”，选择“GLM · 智谱官方 API”，粘贴完整密钥并加密保存。保存只检查字符格式，不会发出模型请求。
3. 点击“用免费 Flash 检查连接”。检查成功后仍需确认智谱账户的余额及计划使用的付费模型权限。
4. 点击“文字任务使用 GLM 分工”并保存，或在各任务、Agent 中选择具体模型。现有 Qwen、DeepSeek、OpenAI 配置及历史记录保留；模型不可用时不会自动改用其他提供商。

当前接入标准对话接口 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，固定使用官方域名，不接受自定义代理地址。

## 模型与费用

| 模型 | 工作站用途 | 官方输入 / 输出参考价 |
| --- | --- | --- |
| GLM-5.3 | 灵感策略、下期策划、评论复盘 | 8 / 28 元每百万 token |
| GLM-5.3 Flash | 日常文案、分镜、评论分类 | 0.8 / 2.8 元每百万 token |
| GLM-4.7 Flash | 轻量试用及连接探测 | 核对时官方免费 |

GLM-5.3 与 GLM-5.3 Flash 始终启用思考，工作站按任务选择轻量或增强推理；不会发送已不支持的“关闭思考”参数。免费 GLM-4.7 Flash 使用非思考模式。当前 GLM 接入仅用于文字任务；图片生成仍由图片服务完成。

项目预算统一以美元展示，GLM 人民币参考价按约 7 元/美元折算，输入值向上取整到小数点后三位，未计算缓存或临时折扣。思考输出包含在服务商返回的输出 token 中。预算预留不是服务商收费上限，最终费用以智谱账单为准。发生超时、截断或格式校验失败时保留已有内容，并按已返回用量或预留金额记账；应用不会自动重复付费请求。

## 连接检查的边界

连接检查调用官方免费 `glm-4.7-flash`，仅发送固定短句 `Reply with OK only.`，最大输出 16 token。它不携带品牌、账号、项目、素材、经验或 Skills 内容，也不调用所选付费模型。

成功只说明密钥可以完成这一次免费模型请求。付费模型显示“权限待验证”，不会被描述为已经开通；检查也不查询余额。免费政策与限流可能调整，应以智谱最新公告为准。检查失败时先看错误解释，不要重复提交创作任务来试密钥。

## 密钥保存与错误反馈

- Windows 用户工作区沿用登录密码及 Windows 账户保护；团队工作区沿用既有服务器加密保险箱。GLM 密钥单独保存，不复用 OpenAI、Qwen 或 DeepSeek 密钥。
- 联网网页版在当前浏览器中以登录密码加密保存。调用时只将本次选中提供商的密钥临时交给网站后端及智谱官方接口；后端不长期保存。另一个本地用户不会继承密钥。
- 设置响应、工作区备份与诊断导出不包含完整密钥；页面只显示末尾四位。
- 鉴权失败：检查密钥是否完整、失效，以及是否属于标准 API。
- 余额不足（如业务码 1113）：检查账单或充值；换一份密钥不会恢复余额。
- 权限/类型不匹配（如 1311、1315）：检查付费模型权限和 API Key 产品类型。
- 频率受限（如 1302）：等待页面建议时间；冷却期间不会重复发送相同模型请求。
- 输出不完整：现有内容保留；先查看费用与诊断，再决定是否重新生成。

## 官方来源

- [GLM-5.3 模型与强制思考参数](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
- [GLM-5.3 Flash / FlashX](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
- [GLM-4.7 Flash 免费模型](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)
- [模型定价](https://docs.bigmodel.cn/cn/guide/start/pricing)
- [标准 API 与 Coding Plan 密钥分类](https://docs.bigmodel.cn/cn/coding-plan/notice/api-key-management)
- [结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [错误码](https://docs.bigmodel.cn/cn/api/api-code)

开发验证使用固定模拟响应，覆盖五阶段调用、密钥隔离、浏览器加密用户切换、错误脱敏、限流和不完整输出。没有使用用户真实密钥调用收费模型。
