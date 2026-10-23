# 2.3.0 开发交接

总控入口为 src/components/ControllerChat.tsx，样式仅作用于 controller-main。聊天主体只有一个输入框，任务详情、计划编辑、指令、Skills 和付费批准放入 Modal。WorkMedia 提供 compact 模式，WorkPublish 将已采用图片接到现有 MCPPublishDialog、ExportDialog 和人工结果登记。发布范围由固定项目、账号、素材版本和登录会话约束。

server/work-chat.mjs 保存 controller-message，通过幂等键防止重复需求；规划引用消息而非客户端重发的另一份文本。work-planning-control 在异步凭据核对前后检查同消息的 planningRunId，避免多个报价并发重复执行。问答只使用公开规划记录，排除任务私聊、原始请求和凭据。

server/work-revision.mjs 白名单读取当前任务已采用成果；revisionSource 只能由服务端根据当前任务添加。总控和写作输入都使用同一顶层正文。派工估算/批准核对当前版本，已完成的历史修订节点可以原样复用；独立分叉的旧稿建议必须回原任务重新规划，避免跨任务引用。现阶段局部修订支持不超过8000字正文、200字标题；超长人工稿会明确拒绝，不截断后收费。

controller-view 新增 replyTaskId、replyRunId、newConversation。备份增加 controller-message 与关联校验，含时间戳校验。已有单账号/矩阵归属继续保持，用户权限和真实发布确认没有扩展。

验收 fixture 是 tests/fixtures/controller-workspace-ui.mjs：内存加密数据、模拟文案和测试图片，全部外部请求禁用。回归见 work-control-planning、work-dispatch-control、work-control-ui 等测试；完整范围见 VALIDATION-2.3.0.md。

后续：现有后台写作角色仍为小红书文案、抖音研究、抖音脚本；聊天中的图片/发布使用现有图片和平台服务。直接投稿目前单图，扩展多图需同时更新资产快照、平台参数、批准范围和回执，不可直接循环单图发布。
