# v1.24.0 开发交接

本次围绕账号矩阵增加平台账号的持久身份与创作方案，并接入电脑文件选择 / 拖拽和发布就绪提示。工作站用户、项目、平台账号继续区分；没有新增自动发布授权，也没有重构已有账号登录和加密存储机制。

## 账号身份与方案

`server/account-creation.mjs` 统一校验、保存和解析账号创作配置。`Account.creationProfile` 包含 `revision`、`identityMarkdown`、`identityFileName`、`presets`、`defaultPresetId`。身份正文按 UTF-8 字节数限制为 24 KB，允许 `.md` / `.txt` 文件名，拒绝无效字符；文件作为创作文字保存，不执行脚本、命令或其他权限声明，不依赖原文件路径。

每个账号最多 12 个 preset，保存名称、长期主题、补充要求和分步骤 `skillSelections`。步骤缺省继承工作区，空字符串表示仅使用内置规则，指定 ID 则解析该步骤已有的已启用 Skill。平台文案步骤不能绑定到其他平台账号。配置保存使用 profile revision，冲突时要求重新打开，不覆盖另一处修改。

`Project.creationSelections[platform] = { accountId, presetId }` 保存项目显式选择，`State.activeCreationAccounts` 保存当前平台账号映射。解析优先采用项目选择，其次采用平台当前账号；只有一个同平台账号时可以自动使用它。显式选择不存在时返回清晰错误，不自动换成其他账号。移除已被项目选择的方案时，回到该账号的默认方案，并保留既有生成快照。

接口为 `PUT /api/accounts/:accountId/creation-profile` 和 `PUT /api/projects/:id/creation-selection`，浏览器本地 API 同样支持保存。平台登录账号经既有 `mcpAccountId` 关联到发布账号，切换时更新当前创作账号映射。`src/pages/AccountCreation.tsx` 提供身份文件导入 / 导出、编辑、方案管理和创作账号选择器，设置页、平台账号管理、策略及内容生成入口复用这些组件。

## 生成与账号归属

`resolveAccountCreation` 在请求开始时解析身份、方案和当前步骤 Skill，`accountCreationInstructions` 将结构化账号上下文加入生成输入。账号身份是表达与定位要求，不能覆盖已确认事实、本次明确要求、输出结构、媒体参数或发布授权。多平台策略分别携带各账号上下文，不把多个账号的语气和经历混成一个身份。

策略、文案、封面、关键帧及视频沿用现有生成与预算流程，保存 `creationTrace` / 请求上下文快照。生成中的配置变化不重新指定任务账号。已绑定其他账号的文案在生成新配图或视频前需要按当前账号重新生成文案，防止旧文案与新账号画面混用。历史成品和恢复流程保留对应快照；发布默认账号参考生成快照，账号被移除时要求显式选择，改选其他账号显示身份核对提示。

`WorkflowSkillSummary` 和媒体提示词预览按素材平台解析有效规则。工作区原有 Skills 保留为默认值，旧账号缺少 `creationProfile` 时返回空配置，旧项目缺少账号选择和快照时保持原有行为，不要求批量迁移历史数据。

网页中转继续保护私人创作资料。`src/web-payload.ts` 在发送前阻止带身份记忆、私人方案要求或自装规则的请求；`server/web-skill-privacy.mjs` 排除相关配置与快照字段。网页本地可以保存配置，使用这些资料进行 AI 生成须在 Windows 本机版完成，不允许为通过中转而静默剥离有效记忆。

## 本地素材

`src/local-media.mjs` / `.d.mts` 管理支持格式、大小和文件头检查，允许 Windows 常见的空 MIME 和别名按扩展名规范化，同时核对实际文件头。`src/components/LocalMediaFiles.tsx` 提供统一的文件选择与拖拽区、项目参考上传和成品预览采用。

参考图片支持 PNG / JPEG / WebP，配音支持 MP3 / WAV / M4A / OGG / WebM，均限制 8 MB，复用 `PUT /projects/:id/media`。参考图仍属于项目，可在同一项目中复用，按生成开始时的图片数据使用；配音沿用免费本地短片合成。成品图片支持 PNG / JPEG，视频支持 MP4 / WebM，限制 16 MB，编码后低于现有 24,000,000 字符的素材上限，复用 `PUT /projects/:id/assets/:assetId`。没有新增视频参考模型能力或上传即生成行为。

图片先通过浏览器解码，视频预览加载成功后才允许确认采用。读取、解码和上传在全局任务锁内执行；组件使用 scope / 挂载身份防止切换项目或退出后继续提交旧读取。成品选择保存当时的 asset revision，确认时再次检查，服务端继续用 `expectedRevision` 拒绝旧版本覆盖。导入成品遵循原有历史保存和文案校验，不产生模型请求。创作页格式标签不再把任意导入素材固定标成 3:4 图片或 12 秒视频。

## 发布准备状态

`server/publish-readiness.mjs` / `.d.mts` 提供仅用于展示的 `assetPublishReadiness`，区分有效当前成品、尚未制作、图片候选未采用、关键帧未转视频、生成中、失败 / 待核对、旧版本画面和文件缺失等状态。有效当前成品优先，后续 AI 重做失败不阻挡已有有效成品。

`Studio` 的“前往发布”不再因未就绪而静默禁用；卡片说明原因，导出仍需有效成品。`PublishPage` 同时展示成品与待准备内容，提示返回对应制作步骤。辅助判断不替代导出和发布接口校验，打开页面不创建投稿，也不更改既有发布确认范围。

后续联调请使用隔离工作区和合成文件，分别检查账号切换中的任务归属、旧版本素材拒绝、文件读取中切换项目、网页隐私拦截，以及实际平台发布前的账号核对。前序养号图文设计见 [v1.23.0 交接](DEVELOPMENT-HANDOFF-1.23.0.md)，用户操作见 [v1.24.0 使用说明](UPGRADE-1.24.0.md)。
