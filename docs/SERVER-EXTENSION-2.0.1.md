# v2.0.1 服务扩展边界

本地 Qwen 新增 `/api/settings/providers/local-qwen/connection` 及独立 credential/check 接口。连接只接受回环 HTTP 指定端口、固定 `/v1`，生成只访问 `/chat/completions`，探测只访问 `/models`。团队主机设置由管理员管理；普通工作区成员可按原权限使用既有配置。静态/网站 relay 不得转发内网请求。

发布仍使用原 `/projects/:id/publications/:publicationId/mcp/publish`，新增可选 `expectedConnection` 快照校验；服务器对同一记录保持提交锁，跨平台独立记录可以并行。页面批次不是新的无确认自动发布入口，也不提供后台无人值守批量重试。

本地 MCP 管理复用现有主进程 IPC，不新增 HTTP 运行命令端点。程序选择、固定参数、用户/账号隔离目录及自有进程停止约束保持不变；不会按端口或程序名杀死未知进程。

研究诊断只返回本地允许的错误类别和安全建议，不暴露完整上游响应、令牌、Cookie或私有路径。来源图片可缺失；保存的描述/分析必须注明来源而非假称视觉验证。
