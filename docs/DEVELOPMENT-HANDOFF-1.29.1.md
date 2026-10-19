# v1.29.1 开发交接

修复范围：Redfox 小红书近期取数、明确授权下的补页与详情补全、本轮取数摘要、安全错误诊断和费用确认。未新增收费服务，未改变发布授权。

主要模块：

- `server/redfox-research-plan.mjs`：前后端共享的请求上限与费用计划。
- `server/redfox-social.mjs`、`server/redfox-social-catalog.mjs`：官方接口排序、分页、详情补全与来源计数。
- `server/research-routes.mjs`、`server/research-data.mjs`：请求校验、本轮摘要、筛选和错误原因；失败时保留历史资料。
- `src/pages/Research.tsx`、`src/types.ts`：补充读取选项、费用确认和摘要展示。

兼容要求：`redfoxXhsExpansion` 默认 false；旧数据没有摘要时不能伪造为零。账号/项目切换与版本变化应阻止后续请求。部分来源失败时可用证据仍可分析，但失败状态必须可见。模型请求只能使用本轮合格证据；标题不能伪装正文。

已缓存的官方接口定义位于 `.tools/redfox-docs/`，仅用于开发核对，不作为用户配置或密钥文件打包。运行测试及构建的结果见验收说明。服务器扩展、加密和多成员边界见 `SERVER-EXTENSION-1.29.1.md`。
