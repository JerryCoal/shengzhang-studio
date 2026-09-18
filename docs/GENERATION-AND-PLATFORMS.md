# 生成、发布与评论连接

更新于 2026-09-12。本轮在现有本地应用中新增实际接口、任务状态与操作界面；未配置用户真实密钥，未实际产生图片/视频费用，也未向社交平台发作品。接口协议已用模拟服务响应测试，最终权限和效果仍需用户账号联调。

## 开始使用

1. 打开“连接与设置”。上方保存 OpenAI API Key；下方保存 Seedance API Key、服务区域和控制台中已开通的模型/接入点 ID。使用支持首尾帧的 Seedance 型号；带声音生成需该型号支持 `generate_audio`，如 1.5 Pro 或 2.x。不同区域的密钥不可混用。
2. 在“内容制作”上传产品参考图，打开视频任务的“AI 视频 · 首尾帧”。分别生成首帧、尾帧，检查产品外观、文字和场景连续性，再确认 5/8/12 秒视频生成。首帧使用产品参考，尾帧同时参考产品图和首帧。
3. 视频在服务端后台生成，页面可以关闭，服务需继续运行。系统保留 Seedance 任务编号，并自动查询和下载成品。单个下载文件上限约 17.9 MB；超限或下载域名不被支持时保留任务和费用记录，可到平台控制台下载。此上限适合当前以 base64 保存素材的小规模 MVP。
4. 抖音开放平台应用审核通过后，在设置填写 Client Key、Client Secret 和平台注册的回调地址。申请 `video.create`、`video.data`、`item.comment` 权限，点击“准备授权”，打开平台确认后将完整回调地址粘贴回来。回调码只使用一次，15 分钟失效；平台若不接受 localhost，需使用已注册 HTTPS 回调地址。回调页无需代管用户令牌。
5. 在发布中心安排视频，再点击“启用抖音自动发布”，检查视频、单独的投稿短文案、账号和时间，勾选确认。到时自动上传、创建作品、查询审核，平台确认公开后才显示“已发布 · 平台确认”。授权被更换或失效会暂停后续操作。
6. 在评论页对已关联的抖音作品开启“每 15 分钟自动同步”，也可立即同步。系统采集接口可见的一级评论，保留原文、发表时间、点赞数、来源和评论编号；不使用网页登录爬虫。每轮最多 10 页、500 条，更多分页在后续检查时续采，完成后从首页重新检查。暂不采集回复，也不把未返回的评论判定为已删除。

## 费用和失败恢复

- 图片型号固定 `gpt-image-2`，没有改用 2.5。关键帧分辨率 864×1536，提供 low/medium/high 质量。每张预留 $1；返回有效用量时按文本输入 $5、图片输入 $8、图片输出 $30 / 百万 token 估算，缓存折扣未计入。
- Seedance 不同地区、型号、音频档位和活动价格不同，由用户按控制台填写美元单价，人民币报价需自行换算。按 `usage.completion_tokens` 记录估算；单价填 0 则保留预留金额。预留用于项目预算检查，**不是服务商单次收费上限**。
- 不明确的收费请求不会自动重发。图像生成或视频提交中重启，会标为待核对；已取得 Seedance 任务编号的生成可以继续只读查询。关键帧与素材版本关联，生成期间编辑内容不会覆盖新版本。
- 抖音创建作品前先持久记录提交状态；中断且没有作品编号时，标为“结果待核对”，不自动重复投稿。已有编号可继续查询；也可在核对真实作品后关联平台 `item_id`。它通常是平台返回的加密编号，不等同于分享链接中的数字。
- 自动操作依赖当前本地服务，无系统关机唤醒、云端调度或大规模任务队列。审核未通过的投稿不会宣称已公开，连续查询失败后停下来等待人工检查。

## 凭证范围

OpenAI、Seedance、抖音应用凭证及 OAuth 令牌分别在 `data/private/` 中使用 Windows 当前用户 DPAPI 加密。完整凭证不进入 SQLite、JSON 备份、前端持久存储、应用安装包或日志；网络调用限定官方服务地址，生成文件下载不携带密钥。配置只允许本机 loopback 请求，远程来源和代理转发不能使用本机个人密钥。

应用运行时必须解密凭证供请求使用，因此不承诺抵御已控制同一 Windows 账户的恶意软件。安卓/iOS 和其他操作系统的原生凭证保险箱仍待实现，当前不会降级成明文保存。删除本机抖音凭证会停止后续自动任务，平台授权可另在抖音中撤销。

## 官方依据

- [GPT Image 2 型号与价格](https://developers.openai.com/api/docs/models/gpt-image-2)：型号 `gpt-image-2`；图片输出，不直接生成视频。
- [OpenAI 图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)：Image API 的 `/images/generations` 和 `/images/edits`，返回 `b64_json`。GPT Image 2 分辨率需符合约束，不能额外传 `input_fidelity`。
- [Seedance 创建任务](https://docs.byteplus.com/en/docs/ModelArk/1520757)：支持首帧和首尾帧图生视频，使用 `content[].role=first_frame/last_frame` 和 `image_url`，可传图片 data URL；端点为 `/api/v3/contents/generations/tasks`。国内对应[火山方舟官方文档](https://www.volcengine.com/docs/82379/1520757)。
- [Seedance 查询任务](https://docs.byteplus.com/en/docs/ModelArk/1521309)：按任务 ID 查询，成功后取 `content.video_url`；下载链接会过期，应用尝试及时保存。
- [抖音网站 OAuth](https://open.douyin.com/platform/resource/docs/develop/permission/web/oauth2)、[获取 access token](https://open.douyin.com/platform/resource/docs/openapi/account-permission/get-access-token)、[刷新 access token](https://open.douyin.com/platform/resource/docs/openapi/account-permission/refresh-access-token)：授权凭证使用接口返回的有效期，按需刷新。
- [上传视频](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/upload/)、[创建作品](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/create-video)、[查询作品](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/video-data/)：发布采用账号授权、独立用户确认及平台审核状态。
- [抖音评论列表](https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list)：`item.comment` 权限，游标分页，可取得评论原文、编号、时间及点赞数。
- [小红书官方分享 SDK](https://agora.xiaohongshu.com/doc)：分享进入客户端的发布流程。查到的公开资料不足以实现通用后台发笔记或评论采集，因此本轮保留手动流程；不将此判断表述为所有技术路径都不可能。

## 验证

46 项自动测试通过，包含原有业务链路、真实 Windows DPAPI 加密/重开/篡改拒绝，以及新接口的模拟测试：首尾帧参考关系、精确型号、token 费用、预算拒绝、并发/过期版本、Seedance 幂等查询和重启保护、OAuth 单次 state 校验与令牌续期、权限不足拦截、重复投稿防护、公开状态确认、评论分页和人工校正保护、凭证不回显、下载地址限制。后台进度更新不会误判正在生成的策略失效。类型检查与生产构建通过，安卓和 iOS 工程已同步最新网页资源。

桌面和 390px 手机尺寸检查了设置卡片、输入框、模型选择器和关键帧弹窗，无横向溢出。独立内存工作区中，通过页面操作走通首帧、尾帧、视频成品保存、发布排期、自动投稿、审核成功、评论采集及定时同步开关；服务商响应和素材均为模拟，正式工作区数据未写入测试记录。实际外部模型生成、抖音授权回调、作品审核和评论可见范围必须用真实账号验证，不能用模拟测试替代。
