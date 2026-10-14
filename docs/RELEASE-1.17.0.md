# 生长 STUDIO v1.17.0 · 创作与内容研究测试版

本次发布累计包含 GitHub v1.7.0 之后的本地迭代，同时补齐源码、Windows 包与开发交接文档。保持 Pre-release 状态，历史正式版 v1.2.0 和旧测试版继续保留。

## v1.17.0 新增

- Seedream 图片连接增加默认可见水印设置，兼容旧配置。
- 封面和 Seedream 首尾帧支持按次覆盖设置，生成记录保存实际请求选择。
- Windows 本机 OCR 检查可疑边缘文字标签，结果展示位置并支持放大核对原图。
- 检查异常不丢弃已生成图片、不重复计费请求；不自动修改原图。
- 旧图、缺少系统识别组件和不支持的系统显示明确的人工核对提示。

- 新增中文开发交接文档，说明运行、模块、数据、验证、限制与后续任务。

## 自 v1.7.0 以来的累计更新

| 范围 | 已合入功能 |
| --- | --- |
| 模型与写作 | Qwen 地域/业务空间和密钥修复；14 份内置 Skills；可安装个人文案 Skills 并记录生成时规则；可维护敏感词、规则优先修改与 AI 语义复核 |
| 语料与内容研究 | 可选 Qwen 向量＋关键词 RAG；公开新闻、Qwen 联网、豆包搜索及小红书 MCP；按日期、来源与可见互动清洗，再生成带引用的参考 |
| 小红书选题 | 七天、三十天或不限时间的相关帖子发现；可选 DeepSeek Flash/V4 Pro 分析具体改进动作与验证方法；仅使用用户确认的参考 |
| 平台工作流 | 内置 MCP 连接修复、外部 MCP 下载/启动/登录引导；小红书发布与评论适配；抖音外部发布适配，其评论仍走内置助手或可选官方接口 |
| 使用体验 | 后台任务可收起等待；四档字号与重点阅读；改善连接设置与窄屏布局；保留飞书排期、评论分类与运营指标空间 |

最终发布仍需用户确认，不等同于无人值守定时投稿。采集仅限平台实际可见或返回的数据，不能保证全量；高互动样本排名不代表全站热榜。

## 下载与升级

- [Windows x64 ZIP](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.17.0/Shengzhang-Studio-1.17.0-windows-x64.zip)
- [SHA-256 校验文件](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.17.0/Shengzhang-Studio-1.17.0-windows-x64.zip.sha256)
- [开发交接 Markdown 下载](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.17.0/DEVELOPMENT-HANDOFF-1.17.0.md)
- [源码与交接文档](https://github.com/JerryCoal/shengzhang-studio/blob/v1.17.0/docs/DEVELOPMENT-HANDOFF-1.17.0.md)

等待旧版任务完成并保存结果，从托盘完全退出旧版，再完整解压新版，双击 `ShengzhangStudio.exe`。同一 Windows 用户下继续使用原有本地账号、项目和密钥。包内含「开发交接说明.md」及「新版功能与使用说明.md」。

## 验证与限制

- 全量自动测试 **534 项通过**，无失败、无跳过；桌面、联网网页及静态构建通过。
- Windows 成品包完成用户隔离、加密保存与重启恢复验证；源码测试中的合成中英文角标识别通过，成品包另以合成中文角标验证真实本机 OCR，原图片字节不变。
- 桌面与 390 像素窄屏在最大字号下通过 10 组布局检查；生成、收起、确认采用及首尾帧流程经过模拟接口验收。
- 历史 v1.7.1 完成小红书真实连接与 11 条自有评论去重导入；本次没有调用真实付费模型，也没有进行真实平台最终发布。权限、网络、平台页面变化和实际生成质量需另外验证。
- 自动角标检查可能漏检；“未发现”不代表没有水印。当前生成记录不构成永久版本审计档案。
- 当前以 Windows 本地工作站为主，未提供持续托管的公网后端、团队数据库或手机签名安装包。

详细记录见 [验证说明](https://github.com/JerryCoal/shengzhang-studio/blob/v1.17.0/docs/VALIDATION-1.17.0.md)。旧文档中的“尚未上传”描述当时状态，本次累计发布不补造它们的独立 Release。
