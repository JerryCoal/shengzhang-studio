# 飞书发布计划同步调研

调研日期：2026-10-09。本次先核对公开项目与官方接口，再独立实现发布中心的一向同步，不引入第三方项目代码或运行依赖。

## 参考案例与采用方式

| 资料 | 能确认的做法 | 本项目采用方式 |
| --- | --- | --- |
| [shou-nian/feishu-mcp-server](https://github.com/shou-nian/feishu-mcp-server) | README 描述先读取实时字段结构、校验类型，再按记录 ID 更新指定列。该仓库的说明不等于本项目真实账号验证。 | 先检查字段类型，按返回的记录编号更新，保留负责人和团队备注。 |
| [BlueSkyXN/Feishu-Bitable-Python-API 的更新记录代码](https://github.com/BlueSkyXN/Feishu-Bitable-Python-API/blob/main/UPDATE_RECORD.py) | 直接用 PUT 请求与 fields 对象更新已有记录，身份凭证单独传递。 | 使用官方记录接口，但凭证改为现有本机加密保险箱保护，不采用明文配置文件。 |
| [scottzx/1agents 的双向同步提案](https://github.com/scottzx/1agents/issues/101) | Issue 提出本地任务与外部记录映射、更新及冲突策略；这是设计提案，未据此声称其功能已交付。 | 使用固定计划编号和外部记录编号；第一版单向同步，发现团队修改时暂停，避免静默覆盖。 |
| [飞书新增记录接口](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create) | 支持 client_token 防重复标识；日期为毫秒时间戳，链接等字段有指定结构；同表写入冲突需要处理。 | 持久保存防重复编号及本次请求快照；超时后先查询核对，不改变原请求重新建行；本进程同表串行写入。 |

## 最终方案

- 桌面后端直接访问固定的飞书官方域名，无需另建公网服务器。
- 团队自建应用取得表格权限。App Secret 仅进入当前本地用户的加密保险箱；临时访问凭证只在内存中缓存。
- 用户在飞书新建空白多维表格并授权应用；App 检查和补齐缺少的标准列，不改已有列的类型、不删除现有列。
- 发布计划以项目 ID 与计划 ID 组合匹配；查询发现重复编号时停止，要求人工处理。
- 每项目显式开启自动同步；也可预览共享范围后手动同步。未连接、示例项目及示例记录不上传。
- 只上传八个排期字段；负责人仅在首次创建时填写，后续保留团队编辑。团队备注从不覆盖。
- 同步前对比上次同步快照与飞书当前值。冲突提示涉及列，并要求用户明确采用 App 版本。该检测不是跨应用的数据库原子锁；建议多人避免同时编辑 App 管理列。
- 网络故障保留计划，自动补偿最多三次并延迟重试。原记录删除时不自动重建，避免恢复团队已删除的事项。
- 更换目标表格后关闭各项目自动同步，需重新确认共享。

## 第一版边界

不含双向同步、AI 生成一周排期、附件上传、知识库 /wiki/ 链接、成员通讯录或群消息通知。不修改抖音和小红书最终发布的人工确认机制。标准字段暂按固定名称与类型连接，不支持任意列名映射。

## 官方依据

- [多维表格概述与鉴权](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [新增字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create)
- [更新记录](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update)
- [飞书官方权限配置示例](https://www.feishu.cn/content/137710114294)

实际接入需要团队自建应用、权限审批和真实表格。本地模拟验证用于确认同步逻辑，不能代替真实租户验收。
