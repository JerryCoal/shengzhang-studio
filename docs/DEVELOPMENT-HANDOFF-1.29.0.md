# 1.29.0 开发交接

## 主流程与持久数据

`server/content-workflow.mjs` 为平台无关纯业务模块。HTTP 通过 createApp 挂载；浏览器加密本地适配调用同一业务函数。Project.knowledge 保存持久资料与经验；Asset.contentBrief 保存本篇需求、绑定账号和显式引用。已有 Strategy/Asset/Publication 关系保持兼容。

内容创建与收藏使用请求编号防重复；编辑使用 expectedRevision；发布安排增加可选 expectedAssetRevision 防止核对旧内容后保存新快照。HTTP adapter 继续复用已有 store、鉴权、团队权限和加密保存。

生成按主题、账号和期限选取知识；来源与选择快照写入结果。直接草稿以绑定账号解析创作身份，浏览筛选不修改归属。外部参考与经验不升级成项目事实，评分样本保持独立证据约束。

## 界面入口

- App/context/workspace-route：五个主入口、账号浏览范围、作品级跳转；URL仅携带定位字段，不包含私人需求正文。
- ContentStudio：列表和单篇编辑；原 Studio 导出兼容保留。
- KnowledgeLibrary/Trends：发现、收藏、文档与经验保存；创建内容携带知识条目ID。
- PublishWorkspace：按账号与版本整理状态，发布方式集中核对。
- ReviewWorkspace：围绕同一发布记录限定指标、评论、采集和经验来源。
- ProjectProfileEditor：长期项目资料；新内容需求在草稿中维护。
- BackgroundTask.target：冻结启动位置，返回任务恢复对应内容。

## 兼容与隐私

旧数据字段可缺省；旧策略与养号输入不破坏性迁移。独立网页中转剥离私有知识和直接草稿身份；直接草稿的联网生成明确要求本地/团队服务，不在缺少账号上下文时回退生成。

服务器连接与后续数据库/任务存储扩展见 SERVER-EXTENSION-1.29.0.md。实际构建、检查、已知限制以 VALIDATION-1.29.0.md 为准。
