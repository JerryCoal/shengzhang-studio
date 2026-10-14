# v1.9.0 开发交接

2026-10-14，工作目录为仓库根目录。本版全流程 AI Skills 已接入，当时尚未上传 GitHub；旧 v1.8.0 Windows 包保留。此文档记录该次迭代当时状态，累计发布情况见仓库 README。

## 关键位置

- `skills/*/SKILL.md`：12 份内置规则。新 8 份和价格语义规则元数据版本为 `2026.10.14.2`，其余保持实际版本。
- `server/ai-skills-manifest.mjs`：统一元数据；`ai-skill-registry.mjs`：步骤与规则映射、界面目录、版本列表。
- `scripts/compile-copy-skills.mjs`：从 manifest 生成 `copy-skills.generated.mjs`，保留旧导出名称兼容。
- `server/prompts.mjs`：文本和媒体规则接线，规范 `2026-10-14.v6`；媒体只对可变内容筛词，再拼固定规则和实际参数。
- `server/ai-context.mjs`：旧策略字段白名单、精确任务前缀去重。`src/web-payload.ts` 同步按已确认简报筛选语料。
- `server/ai-routes.mjs`、`media-generation.mjs`：使用记录包含 `skillVersions`。普通文案仍保存完整 Skill trace，媒体保留完整 recipe。
- `src/pages/CreativeSkills.tsx`：12 场景折叠目录；`InputAssist.tsx`：步骤规则展示；媒体预览接收实际参数。

## 保护与后续

用户安装 Skills 仍只在普通文案选择使用；联网 Web 不发送自装规则、完整安装库或历史规则快照。不要未经新授权移除该边界。不存在自动更新网络 Skill 或执行其中脚本的能力。

现有热点采集、关键词语料检索、本地审核及 MCP 是独立工具。用户先前提出的“近期爆款内容 → 清洗 → 检索 → AI 总结 → 生成参考”仍需继续独立开发，见 `docs/RECENT-CONTENT-RESEARCH.md`。新规则不会自动获得联网或向量检索能力。

回归与构建参见 `docs/VALIDATION-1.9.0.md`。真实模型质量尚未做付费测试，后续用小批固定样本评估。不得从模拟响应推断准确率或降本比例。
