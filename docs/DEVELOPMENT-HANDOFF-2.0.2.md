# v2.0.2 开发交接

## 范围

只改灵感 Agent 的对话交互；复用现有 React、Express、加密工作区、策略接口与任务中心。其他 Agent 仍为既有页面。共用保存流程增加会话检查、退出前刷新以及服务器修订同步，但不改变其创作交互。没有新的联网服务、模型下载、自动采集或自动发布入口。

## 主要文件

- `src/components/InspirationConversation.tsx`、`src/inspiration-conversation.css`：作用域内聊天布局、真实进度槽、历史滚动、键盘确认与折叠选项。
- `src/pages/InspirationChatWork.tsx`：费用确认、冻结目标、保存后提交、失败恢复、研究/资料入口、方案编辑与显式交接。
- `src/pages/AgentWorkspace.tsx`：灵感入口接线、私有草稿持久化、最新修订与会话保护。
- `src/inspiration-chat-state.mjs`：目标建议、账号上下文过滤、清除跨账号私有选择、语义指纹与最新方案交接。
- `server/inspiration-conversation.mjs`：严格对话数据解析，最新消息与有限历史分离，安全上下文组装。
- `server/agent-workspace.mjs`、`server/agent-workspace-routes.mjs`：私有记录、提交回执、读取时恢复、不可变提交轮次及归档。
- `server/ai-routes.mjs`、`server/prompts.mjs`：现有策略请求的可选灵感轮次协议，严格参数、服务端去重、原子保存策略与回复。
- `src/App.tsx`、`src/context.tsx`、`src/BackendAuth.tsx`：冻结任务账号、真实检查点状态和退出前等待草稿保存。

## 状态与边界

一段对话最多 20 轮；单条输入最多 4000 字符且未发送输入保留空白。仅同平台/账号最近 4 轮完成记录进入模型上下文，文本总大小受限。上下文是非可信创作材料，不是工具指令、事实证据或图片视觉读取的证明。

提交顺序是保存 pending 轮次 → 服务端原子认领 → 调用现有策略能力 → 原子保存策略、回复、最新成功需求和修订。回执按成员隔离，与最多 20 轮历史分开保留（上限 2000）；归档不允许复用旧轮次编号。失败不覆盖上一份方案，不自动重试。进程退出后读取草稿会恢复孤立的已认领状态；尚未认领的 pending 需要人工取消/核对。

UI 的同步引用锁阻止连点；确认指纹排除自动保存时间戳、按对象键规范化。登录会话变化后每次草稿 GET/PUT 重试及后续动作均停止；原请求仍归原成员。刷新结果前先完成保存，并锁住输入。交接不传完整 conversation，以最新已确认 idea 为准；非绑定通用方案也必须选择真实接收账号。

进度来源是实际保存、请求和检查点，不模拟模型内部推理；第三方请求在发出后不保证取消。历史异常提示不得宣称服务端绝对没有生成或不会收费。

## 检查与交付

新增测试：`inspiration-conversation.test.mjs`、`inspiration-chat-state.test.mjs`、`inspiration-chat-ui.test.mjs`、`inspiration-chat-integration.test.mjs`。集成界面测试为 SSR 与模拟 hooks/事件回调，非真实 DOM。

本次包仅本地生成，不上传、不提交 Git、不创建远端 Release。最终回归、打包后端检查和未验范围以 `VALIDATION-2.0.2.md` 与包内 `release-manifest.json` 为准。旧版本及真实用户数据保留；开发验证只使用隔离合成数据。
