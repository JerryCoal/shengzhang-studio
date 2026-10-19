# v1.26.0 Redfox 接入交接

## 结构与配置

- `server/redfox-client.mjs`：仅接受固定接口注册表，固定 `https://redfox.hk`，使用 `REDFOX_API_KEY`；拒绝重定向、不回显上游错误正文、不自动重试。识别业务成功码 `2000`。multipart 由 FormData 设置 boundary，`format` 按官方前端进入 query。
- `redfox-social-catalog.mjs`、`redfox-search-catalog.mjs`、`redfox-media-catalog.mjs`：已核验方法、路径及人民币目录基础单价。折扣及实际扣费不可由目录推定。
- `integrations.mjs`：创建服务、保存三项路由开关、公开配置状态和费用估算。`redfoxUpdating` 与运行任务检查防止配置修改和请求交错；密钥管理受管理员权限限制。
- `profiles.mjs` / `team-app.mjs`：注入独立 `redfox` 凭证保险箱。个人工作区与团队主机继续使用各自的既有加密链路。普通导出不携带服务密钥。

## 数据与研究

`redfox-social.mjs` 等社交适配将五个平台的公开搜索、详情和四个平台评论纳入现有研究、评论预览及作品指标流程。抖音评论明确不支持；小红书评论为异步任务，其余评论只读一页。研究详情读取有数量上限，不隐式翻到所有结果。账号资料接口虽存在于官方目录，本版没有账号粉丝看板。

`redfox-search.mjs` 使用 Kimi 异步搜索，按关键词指纹复用未完成任务和短期缓存。持久化的 `submitting`/`uncertain` 无 taskId 状态拒绝自动重提；有 ID 时只查询原任务。官方 Kimi 响应未保证返回 taskId；如提供则校验一致。缓存仅保留限长、规范化的网页来源字段，不保存生成回答或任意上游对象。

网页来源必须经过 `research-page-reader.mjs` 的公开地址、原文与日期核验，搜索摘要和 AI 回答不能充当正文证据。热榜保存在项目独立字段，查询范围截至上一完整小时；上榜时间不作为作品发布时间，热度不跨平台混算。

## 媒体

`redfox-media.mjs` 提供异步封面、关键帧、视频路径，由 `media-generation.mjs` 和 `cover-generation.mjs` 在开关启用时路由。原直连逻辑保留。模型明确为 Seedream 5.0 Pro 与 Seedance 2.0，本版不提供 Redfox GPT Image 选择。

- 提交前持久化任务和 recipe；提交成功后立即保存 taskId。状态不明不自动重提，恢复有 ID 的任务仅做结果查询。
- 封面用 `aiCover.provider/taskId`；关键帧用 `aiProduction.frameProvider/frameTaskId/frameJob`；视频用 `aiProduction.provider/taskId`。
- 查询端点为既有 `video-status`（亦可查 Redfox 帧）及新增 `cover-status`。重复轮询使用本地锁；返回任务 ID 必须匹配。
- Seedream 参考图使用文档支持的 Base64。视频首尾帧经官方 multipart 上传成 URL，上传 URL 保存到原帧，限定使用期后重新上传。
- 下载限官方 `redfox-hk.oss-cn-hangzhou.aliyuncs.com` HTTPS 地址、公网解析及大小/文件签名，不向 OSS 传 API Key，不跟随跳转。
- 保留 recipe 的账号身份/Skills 快照、原操作者、assetRevision。切换账号不改任务归属；完成时版本变化则保存候选，不覆盖新内容。首次与尾帧身份变更检查沿用原规则。
- 费用由客户端写入 `redfoxUsage`，金额为 `amountCny`，不调用原 `reserve/settle` 美元用量逻辑。异步失败费用仍以真实账单核对。

Pro 官方尺寸区间文案不完整。本版保留封面 1728×2304、关键帧 1440×2560；能否被当前服务接受、实际水印和输出质量未做真实付费验证。图片 URL 文档有效期约 24 小时，下载失败应先查原任务，不应自动创建新任务。

## 前端与交付

Redfox 设置、服务提示、热榜和读取预览位于 `src/pages/RedfoxSettings.tsx`、`RedfoxHotspots.tsx`、`src/components/RedfoxReadDialog.tsx`，研究、封面、关键帧、评论及运营数据页复用这些入口。界面区分“已配置”和真实请求结果，费用提示明确人民币估算。静态版不开放密钥和服务调用。

公开文档快照在开发目录 `.tools/redfox-docs`：26 个分组、169 份详情、抓取清单和 `catalog-notes.md`；生产包不需要这些研究材料。对外限制说明见 `REDFOX-TEST-REPORT-1.26.0.md`。完整回归、页面构建及本地包校验由最终验证文档记录。

后续真实 API 验证应逐功能手动确认费用：只提交一笔并保存 ID，验证原任务查询/下载后再做下一笔；若接口字段与文档不一致，收集脱敏结果修适配，不自动切其他模型或新增付费重试。
