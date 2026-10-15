# 可选本机文档增强解析

Windows 客户端可以连接独立安装的 Docling 组件，读取复杂 PDF、扫描 PDF、DOCX、PPTX、XLSX。原有 TXT、MD、DOCX 和文字型 PDF 的基础读取继续保留，网页版不会声明具备本机增强能力。

## 安装与配置

1. 安装 64 位 Python 3.10–3.13，确保安装时提供命令行入口。推荐使用 Python 官方安装程序。
2. 双击安装包 `可选文档解析组件/scripts/Install-Docling.cmd`（源码仓库中为 `scripts/Install-Docling.cmd`）。组件安装到当前 Windows 用户的 `%LOCALAPPDATA%\ShengzhangStudio\optional\docling` 独立环境。首次安装需要联网下载开源依赖和官方模型，建议预留至少 5 GB 空间；下载失败可重新运行，已有基础读取不受影响。
3. 在“语料库 → 导入项目介绍文档 → 本机增强解析”点击“选择已安装的解析组件”，选择安装窗口显示的 `Scripts\python.exe`。
4. 选择“增强优先”或“增强读取”，导入自己的文档，核对正文、表格、来源页码及警告，再保存。

高级安装可运行 `scripts/install-docling.ps1 -Python '所选 Python 的完整路径' -TargetDirectory '独立安装目录'`。`-OfficeOnly` 只安装 Office 提取依赖，不下载 PDF 布局、表格与 OCR 模型。配置与当前本机账户绑定；切换账户需要重新选择组件。可选组件不随主程序自动升级，当前适配版本为 `docling-slim==2.139.0`。

组件采用 Docling 的 `format-office`、`format-pdf`、`convert-core`、`models-local`、`feat-ocr-rapidocr-onnx` 和 `cli` extras。PDF 使用官方 PDFium 后端，避免部分 Windows 中文目录下原生解析器的资源路径兼容问题。OCR 默认使用本机 RapidOCR 中英模型、CPU 推理。

## 隐私与失败行为

- 安装阶段下载程序包和模型，不选择或上传文档。安装尊重系统信任证书，不关闭证书验证。
- 解析阶段仅接收客户端选中的单个文件字节，使用隔离临时目录。关闭远程模型服务，设置离线标记，并在 Python 审计入口阻止网络连接、DNS 查询和子进程启动。文档内的文字不作为指令执行。
- 原始文件不会进入模型下载步骤。解析完成、失败或取消后，在子进程退出后清理临时副本；如果进程无法退出或清理失败，会明确报错。
- 解析进程只接受应用支持的扩展名，校验文件头、文件体积和 Office 压缩内容，拒绝宏、可执行附件和外部实体声明。采用固定脚本及无 shell 的子进程参数，不接受网页传入的可执行路径。
- 这是受限的本机处理流程，不等于操作系统级隔离沙箱。应使用来源可信的文档，并及时更新组件。原始文档和模板内容不会作为程序执行。
- 增强失败时，“增强优先”可对 DOCX/PDF 退回基础读取并显示具体失败提示；“增强读取”返回失败。PPTX/XLSX 没有伪造的基础回退。
- 保存语料和后续 AI 检索/资料理解是独立步骤，其联网边界以该功能的确认提示为准。“本机解析”不表示后续一切 AI 功能离线。

## 限制与来源定位

增强文件最大 16 MB；基础读取最大 8 MB；PDF/演示文稿最多 100 页；一次增强解析最多 3 分钟；正文最多 30 万字符和 4,000 个内容块；Office 压缩展开最多 80 MB 和 2,000 项。过大文档请拆分后导入。

结果包含标题、段落、列表和 Markdown 表格，尽量保留原始页码及标题。DOCX 不能保证打印页码；XLSX 页码表示工作表序号，标题为工作表名称，公式读取文件已有缓存值且不重新计算。扫描识别、复杂合并单元格和阅读顺序仍需人工核对。缺失信息不会自动补写。

如果手动改写导入预览正文，客户端会清除原来的结构定位，使用普通分段，避免引用指向错误页码。只有保存后的结构会参与资料检索；原始临时文件不保留。

## 官方依据与许可证

- [Docling 源码与 MIT 许可证](https://github.com/docling-project/docling/blob/main/LICENSE)
- [Docling 官方 Skill](https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/SKILL.md)
- [官方 SDK 使用参考](https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/references/python-sdk.md)
- [官方 slim 依赖组合说明](https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/references/slim-packaging.md)
- [本地模型与离线用法](https://docling-project.github.io/docling/usage/advanced_options/)

Docling 程序与该官方 Skill 采用 MIT；独立依赖和模型按各自许可证分发，不应把整个依赖/模型集合笼统标为 MIT。主程序不附带这些大型模型，安装脚本从上游下载并保留上游文件。
