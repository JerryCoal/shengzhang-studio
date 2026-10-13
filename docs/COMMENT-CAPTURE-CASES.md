# 评论采集：案例参考与本版取舍

查阅日期：2026-10-07。用户本轮优先项是「更自动：减少手动展开和滚动」。

## 参考案例

| 案例 | 项目描述的能力 | 对本版的启发 |
| --- | --- | --- |
| [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 多平台、指定作品、评论与回复、登录状态及可视化入口 | 从已登记作品进入，按批次设限，把登录和结果核对做成明确步骤 |
| [RedProbe](https://github.com/Maze-Cat/redprobe) | 浏览器侧控制面板、自动滚动与展开、页面评论提取及导出；说明了虚拟列表可能影响完整性 | 把操作按钮常驻展示，自动加载，遇到无新增停止；每次滚动前暂存，避免只在结束时读取 |

这些是项目文档描述，不等于我们验证了它们的所有功能。本次没有安装或嵌入这些项目，也没有复制其实现。MediaCrawler 的 README 对使用范围有明确限制，因此本版仅参考通用交互思路，自行实现页面步骤与本地缓存。

## 本版实现

`desktop/comment-window.cjs` 管理窗口和采集状态。可信本地工具栏与官方页面分别使用 BrowserWindow / WebContentsView；后者没有 preload，也不暴露工作台 IPC。窗口关闭时主动关闭远程 WebContents 并清理临时会话，遵循 [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) 与 [BaseWindow 生命周期](https://www.electronjs.org/docs/latest/api/base-window) 文档。

`comment-page-step.cjs` 每次只执行一个有界页面动作：检查作品与登录状态 → 按需展开一个回复控件，或滚动实际评论容器。只操作已识别的评论区域，不扫描推荐流、不处理验证码、不拼接私有接口。

`comment-reader.cjs` 保持对评论正文、ID、日期、点赞和回复标记的读取。`comment-buffer.cjs` 跨轮保存安全字段，按 ID 优先去重，并限制数量和字符数。每轮先读取再滚动，列表节点数量不变也可通过新 ID 识别新增。

前端 `CommentImportDialog.tsx` 负责选择批次参数、结果预览、关键词筛选和确认。最终写入继续使用原有导入接口，因此来源校验、评论去重、人工分类和本地加密保存沿用已有逻辑。

## 边界

不增加后台批量账号登录、Cookie 导入、逆向签名或验证绕过。每次由用户主动打开自己的作品开始采集；阶段结果留在内存中，确认导入才进入用户工作区。平台网页和权限可能改变，所以保留手动选中文字、粘贴及文件导入入口。

自动化能减少滚动操作，无法保证平台会展示所有评论。本版对未知结构宁可停止并提示，也不把页面中所有文字当作评论导入。
