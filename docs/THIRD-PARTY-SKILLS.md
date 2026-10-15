# 第三方 Skills 来源与许可

核对日期：2026-10-15。以下为 v1.18.0 新增规则的来源与适配说明；不以仓库关注量或模型自评分作为效果证明。

| 上游 | 本地适配 | 保留与调整 |
| --- | --- | --- |
| [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)（2026-09-23 修订） | `skills/natural-copy-editing/SKILL.md` | 保留事实、语气和确定程度，减少空话、重复与模板化结构；压缩为文案生成内的一次编辑，不输出自评分，不判断作者身份 |
| [blader/humanizer](https://github.com/blader/humanizer)（3.1.0） | 同上 | 借鉴结构检查与文风样本原则；不执行上游工具，不为改节奏虚构个人经历 |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)（product-marketing 2.1.0；copy-editing 2.1.1） | `skills/document-context/SKILL.md`、`skills/natural-copy-editing/SKILL.md` | 产品、受众、条件、证据和品牌声音统一整理；由本地资料卡及引用核对替代读取 `.agents` 目录；保留用户确认，不照搬英文词数或营销承诺 |

源文件是外部参考，不能覆盖工作站授权、项目事实、预算、固定替换词库和输出结构。改编规则作为程序提示词使用，不运行上游脚本、不自动请求上游网站。

自然表达编辑默认在同一次普通文案生成内完成，不增加一次隐藏模型请求；文档资料卡是用户单独触发的生成，会按已选择的策略模型及项目预算计费。现有用户自装文案 Skill 继续可以选用。

Docling 是另外的本机解析组件。其项目代码及官方 docling Skill 标明 MIT；具体解析模型遵循各模型许可。可选组件及其依赖的许可随安装环境保留；此处不将模型权重或第三方二进制归为工作站原创。参考 [Docling 许可证说明](https://github.com/docling-project/docling#license)、[官方使用 Skill](https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/SKILL.md)。

## MIT 声明

下列版权声明分别对应上述三个 Skills 上游，以下 MIT 许可文本适用于各自作品：

- Humanizer-zh: Copyright (c) 2026 歸藏
- Humanizer: Copyright (c) 2025 Siqi Chen
- marketingskills: Copyright (c) 2025 Corey Haines

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
