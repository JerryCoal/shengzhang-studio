# 生长 STUDIO v1.19.0

日期：2026-10-15。**GitHub Pre-release 测试版。** v1.17.0 测试版及 v1.2.0 正式版继续保留；v1.18.0 本地迭代累计进入本次发布，不另建独立 Release。

本版围绕账号矩阵完善五平台连接、同话题内容研究和界面阅读体验。

[下载 Windows x64](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.19.0/Shengzhang-Studio-1.19.0-windows-x64.zip) · [SHA-256 校验文件](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.19.0/Shengzhang-Studio-1.19.0-windows-x64.zip.sha256) · [下载开发交接 Markdown](https://github.com/JerryCoal/shengzhang-studio/releases/download/v1.19.0/DEVELOPMENT-HANDOFF-1.19.0.md)

## 主要更新

- **五平台统一入口**：保留小红书，为抖音、YouTube、Instagram、TikTok 增加明确的服务配置、账号归属和能力提示。评论与发布沿用目标账号，切换连接不会默认复用上一账号的结果。
- **抖音发布与采集组合**：同一账号可以同时配置发布 MCP 和独立采集 MCP；分别保存地址与访问令牌，发布、评论和搜索选择对应服务。
- **海外服务接入**：YouTube 支持视频提交、评论与关键词检索；Instagram 支持图文/Reels、自有评论及具备相应授权的标签发现；TikTok 支持账号与发布权限检查、图文/视频提交。TikTok 当前 MCP 没有评论读取和全网搜索，界面不会将其显示为可用。
- **同话题高表现内容研究**：先取真实样本，再清洗、去重、筛选时间与相关性，按同平台单项实际指标比较。缺失指标保留未知；AI 基于引用样本提出可能原因和可执行创作试验，不虚构播放量或保证增长。
- **更舒适的界面**：灰白底、深灰正文、少量蓝色交互，减少绿色；保留字体与重点加重偏好，完善五平台表单及窄屏布局。
- **累计包含 v1.18.0**：文档资料卡与来源核对、自然表达润色 Skills、可选本机 Docling 解析，以及外部小红书 MCP 多账号、独立登录目录和启动信息保存。重开应用后可按已保存配置重启服务；平台仍可能要求重新授权。

## 安装与使用

下载本页 Windows 压缩包，完整解压后启动 `ShengzhangStudio.exe`。升级前退出旧版后台，继续使用原来的本机用户与数据目录。详细步骤见 [升级说明](https://github.com/JerryCoal/shengzhang-studio/blob/main/docs/UPGRADE-1.19.0.md)。

外部服务的安装、OAuth、账号隔离、素材 URL 与桥接说明随包放在 **`多平台MCP/README.md`**；仓库版本见 [MCP 接入指引](https://github.com/JerryCoal/shengzhang-studio/blob/main/docs/MATRIX-MCP-SETUP.md)。AI 密钥和 MCP 访问令牌进入本机加密保险箱；外部 OAuth 文件由相应服务自行保存。

## 本版边界

平台开发者应用、权限审核和官方 OAuth 需由使用者完成。Instagram/TikTok 的当前适配要求公开 HTTPS 素材地址，TikTok 另需验证域名与发布选项。最终发布继续由用户确认；提交进入平台处理阶段不等于已经公开发布。

已通过 602 项自动化测试、44 张界面截图检查、Windows 启动及打包后端重启验证；另已完成三个海外服务真实进程的握手和工具枚举，以及 TikTok/Instagram 真实上游处理函数的离线返回契约验证。**未用真实海外账号完成授权、最终发布或评论读取。**测试范围见 [验证记录](https://github.com/JerryCoal/shengzhang-studio/blob/main/docs/VALIDATION-1.19.0.md)，开发接手见 [交接文档](https://github.com/JerryCoal/shengzhang-studio/blob/main/docs/DEVELOPMENT-HANDOFF-1.19.0.md)。
