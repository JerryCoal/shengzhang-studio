# v1.11.0 验证记录

日期：2026-10-14。以下区分已取得的证据与待补最终记录，未完成项不能视为通过。

## 已完成：前端与隔离 UI

- TypeScript `tsc -b` 与普通前端 `vite build` 通过。依赖注释与既有大块资源提示不阻断构建；最终安装包构建另行记录。
- 隐藏 Electron 浏览器只允许连接本机隔离测试地址。测试使用临时加密内存工作区、合成参考与模拟 API，不读取用户密钥或真实账号；不进行真实网页搜索、模型生成、平台采集或发布。
- **9 组流程断言通过；1360 / 760 像素下 13 项布局检查通过；17 张截图；0 外连尝试、0 控制台错误。**
- 主记录：`test-results/research1110-ui/result.json`。复现脚本：`.tools/preview-research1110.mjs`、`.tools/research-ui1110.cjs`。测试完成后已停止本次专属服务与窗口。

| 流程 | 已验证结果 |
| --- | --- |
| 搜索设置 | 独立密钥使用密码输入框；保存后输入清空，只显示尾号；不进入 localStorage/sessionStorage；删除需确认；可切换到文字模型页。 |
| 开始研究 | 打开和取消确认弹窗不提交研究；确认请求携带关键词、来源、语义检索选项及授权标记；每 3 秒轮询可展示分析阶段。 |
| 来源证据 | 发布与采集日期分开，日期依据显示中文；空指标显示未提供，真实零保持零，约数与原始值保留；观察与假设分区。 |
| 选择参考 | 风险项未确认不能提交；最多 5 项；提交后保存标签，且风险确认标识随请求传递。 |
| 进入创作 | 已选研究标签显示在策略与 AI 文案输入区；使用模拟生成快照验证策略、素材预览的来源记录；原有 Skills 选择入口仍存在。此 UI 测试未调用模型验证最终生成质量。 |
| 复用资料 | 单独确认后发送 `reuseCollected: true`；模拟后端不增加网页搜索预留。真实跳过采集由后端测试另行覆盖。 |
| 失败恢复 | 模拟分析失败显示可恢复状态，既有 6 张参考卡保持可见。 |
| 浏览器模式 | `browserStorage` 模式不请求研究接口，不允许开始研究；原 RSS 区域仍可展开。 |

已目视检查截图：

- `test-results/research1110-ui/01-search-settings-wide.png`：宽屏独立搜索设置。
- `test-results/research1110-ui/03-research-scope-narrow.png`：窄屏范围、来源与预算。
- `test-results/research1110-ui/09-evidence-wide.png`：宽屏证据、缺失指标与风险。
- `test-results/research1110-ui/08-evidence-narrow.png`：窄屏参考卡。
- `test-results/research1110-ui/13-strategy-tags-narrow.png`：窄屏策略标签与生成出处。
- `test-results/research1110-ui/15-asset-trace-narrow.png`：窄屏素材的生成参考快照。
- `test-results/research1110-ui/17-copy-tags-wide.png`：AI 文案窗口保留 Skills 与近期参考标签。

另有确认弹窗、运行进度、已选标签及失败保留的截图，见主记录。截图来自开发构建，不能代替最终 Windows 包的运行验证。

## 已完成：全量回归与公开 RSS 验证

- 最终完整自动回归 **379 / 379 通过，0 失败、0 跳过**，见 `test-results/research1110-full-tests.txt`。
- 后端使用模拟上游验证查询规划、来源采集、清洗、检索、分析、选择、后续策略/文案生成的串联；覆盖参考与项目事实隔离、过期与无效引用、研究向量复用、失败保留、专用密钥存储、预算分账、网页状态剥离，以及用户文案 Skills 和研究参考组合。通过测试不代表真实外部服务调用成功。
- 单独执行真实、只读、免费的公开 RSS 请求：IT之家 60 条、少数派 10 条，共 70 篇通过近七天日期与清洗检查，见 `test-results/research1110-live-rss.json`。未使用任何 API Key 或付费模型；结果只证明本次来源可达且日期有效，不能证明 AI 分析质量、平台覆盖或爆款识别能力。

## 已完成：Windows 构建运行验证

- Windows v1.11.0 已完成构建，并在隔离测试用户中验证实际运行。结果：`test-results/bundled1110-1791958162842/result.json`。
- 3 次后端启动、36 次本机请求通过；2 个测试用户的搜索密钥与配置隔离，重启后仍保留；检查接口不返回完整密钥，磁盘文件加密。
- 自动登录的 Windows DPAPI 加解密往返通过；14 个工作流、14 份去重内置 Skills 及版本均存在。语料导入本身不调用云服务。
- 这些运行测试使用独立合成数据，付费调用为 **0**。不接触真实用户数据；重启保留的测试不等于覆盖每一种历史版本升级路径。

## 交付收尾记录

普通前端、静态网页、联网网页和 Windows 构建均已通过，包含最终中文界面与教程链接。后两项构建日志为 `test-results/research1110-static-build.txt` 与 `test-results/research1110-web-build.txt`。新增两份 Skills 通过官方 quick_validate 检查。

本地交付文件为 `outputs/Shengzhang-Studio-1.11.0-windows-x64.zip` 及同名 `.sha256`；归档校验结果见 `test-results/research1110-package.json`。此版本没有上传 GitHub，未改变线上站点。

## 未验证的外部效果

真实账号权限、服务商接口实时可达性、实际费用、来源覆盖和 AI 分析质量，尚未由本轮 UI 模拟证明。没有进行真实付费调用或使用真实平台账号验证近期研究。不能把模拟向量、合成热度数据或通过布局检查写成真实召回准确率、爆款识别效果或商业增长证明。
