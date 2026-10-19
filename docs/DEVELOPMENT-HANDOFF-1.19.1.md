# v1.19.1 开发交接

日期：2026-10-16。**本地修复测试版，尚未上传 GitHub。** 本文补充 [v1.19.0 交接](DEVELOPMENT-HANDOFF-1.19.0.md)，仅覆盖外部小红书 MCP 的话题传递修复。

## 问题与实现

原外部小红书图文、视频发布调用固定传入 `tags: []`，正文里的井号文字没有成为独立话题参数。现在从正文末尾提取候选，供发布前编辑，并将纯正文与 `tags` 分别传给 `publish_content` 或 `publish_with_video`。

| 文件 | 职责 |
| --- | --- |
| `server/xhs-topics.mjs`、`server/xhs-topics.d.mts` | 前后端共用的确定性提取、归一化、去重和长度验证 |
| `server/mcp-platforms.mjs` | 仅外部小红书接受独立候选，分离正文与话题后调用上游，保留账号检查和提交锁 |
| `server/platform-delivery.mjs` | 在本次 `delivery` 快照记录 `tags` 与 `topicBinding: 'unverified'` |
| `src/components/MCPPublishDialog.tsx` | 候选编辑、重新提取、投送预览、错误提示与确认失效 |
| `skills/xiaohongshu-copywriting/SKILL.md`、`skills/marketing-copywriting/SKILL.md` | 统一候选格式、用户方向优先和事实边界；版本为 `2026.10.16` |

`splitXhsTopics` 仅提取正文末尾连续标签，兼容 `#词`、`#词#`、`#词[话题]#` 及对应全角形式，避免把 URL 片段、代码和普通井号文本当成话题。`prepareXhsTopics` 在未提供 `selectedTags` 时采用提取结果；显式空数组表示用户清空，不能回退为旧正文里的候选。标签名称规范化、去重后，生成供计数和本次提交记录使用的 `bodyWithTopics`。

## 必须保持的边界

- 仅 `xiaohongshu + external` 接受独立话题参数及编辑界面。内置页面助手仍由用户在平台选择话题，其他平台适配保持原行为。
- 工作站最多 10 个候选、每个最多 40 个 Unicode 字符；正文加话题含井号和分隔符合计不超过 1000 字。前两项为本地输入限制，不应写成平台官方规则。
- 本次提交使用用户核对的候选；正文、候选或账号等相关内容改变后，应重新确认。保留账号归属、版本检查、失败状态和防重复提交。
- `delivery.tags` 是提交候选的记录，不是平台绑定回执；`topicBinding` 保持 `unverified`。当前上游可能选择首条建议或跳过未匹配项，不返回逐项绑定结果。
- 成品、历史版本和手动导出仍保存正文原文，不做全库迁移，不把提取后的正文覆盖回原资产。
- 文案生成 JSON 仍只有原来的 `title`、`body`、`prompt`、`scenes`。话题默认 3—6 个，位于 `body` 末尾独立段，以单井号和空格分隔；不新增模型请求、检索或发布工具调用。

用户可在现有“希望怎样修改？”中填写：“话题方向优先校园学习、大学生和自习室预约，请结合正文选择 3—6 个相关话题。”不需要新增文案接口字段。

## 验证与交付

重点覆盖 `tests/xhs-topics.test.mjs`、`tests/mcp.test.mjs` 及发布弹窗行为；回归保留 `manual-export`、`platform-workflow`、`creator-and-network`、`douyin-mcp`、`ai-skill-routing`、`creative-skills-integration` 和 `research-copy`。测试结果与构建、打包情况统一补记到 [验证记录](VALIDATION-1.19.1.md)。

修改 Skills 后由 `scripts/compile-copy-skills.mjs` 统一更新生成文件，再进行项目检查与构建；不要只修改生成文件。测试应使用合成数据和模拟上游，不读取真实用户资料或为验证而发布作品。本轮未真实发布，平台话题绑定效果仍待经用户明确授权的单条验证。
