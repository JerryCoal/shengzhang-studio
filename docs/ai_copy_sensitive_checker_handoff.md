# 生长 STUDIO：AI 营销文案敏感词自检工作交接

日期：2026-10-07；本地实现版本：v1.3.1。用途：交给 Codex 继续开发和维护。

## 1. 目标与本次交付

为 AI 生成或用户编辑的小红书／营销文案提供本地扫描、固定替换、上下文改写、修改预览与再次检查。保留用户维护敏感词、指定替换文案、停用与删除词条的能力；文案资料按既有本地用户隔离机制保存。

本次已接入应用：词条处理方式、TXT／CSV 导入导出、批量粘贴、位置高亮、免费固定替换、调用当前文案模型生成候选、复检和手动采用。原来的策略／文案生成后固定替换流程仍保留。出现上下文改写命中时，用户在“编辑与自检”点击一次 AI 处理；本版不在生成后静默追加付费请求。

此词库不是官方禁词列表。检查没有命中不等于没有表达风险，也不保证平台审核通过。支持用户明确指定的价格语境同音字替换，不能让模型自行发明替换字或篡改金额与限定条件。

## 2. 架构决策

推荐通用方案：少量长期稳定的 AI 规则放在 `skills.md` / `SKILL.md`；大词库放在 `sensitive_words.txt` 或 CSV；Python 本地检查器负责扫描、位置与规则替换，仅在需要语义理解时调用大模型，然后再次本地检查。

当前应用已有 React + Node.js + Electron 运行环境，网页还需要离线本地检查。为保持 Windows 解压即用，**应用内实际执行的是共享 JavaScript 检查器**，并附带独立的 **Python 3 检查器**。两者的关键行为和 UTF-16 位置通过一致性测试。Python 不是 Windows 应用启动依赖，不能误称应用运行时调用了 Python。独立运行 Python 工具需要本机 Python 3。

应用内技能：

- `skills/sensitive-copy-review/SKILL.md`：保护事实、按命中项进行语义修改、保留表情、不以变形文字躲避风险、严格输出、单次调用后复检。
- `skills/xiaohongshu-copywriting/SKILL.md`：场景与价值明确、短段落、少量相关标签、基于事实、不伪装亲身测评、发布文案与画面要求分开。

`scripts/compile-copy-skills.mjs` 在构建前将这些文档编译为 `server/copy-skills.generated.mjs`，供前后端和桌面包一致引用。小红书文案步骤加载小红书技能；敏感词 AI 改写再加载审核技能。修改技能后应重建应用，不要只替换发布包里的参考文档。

为什么不把整个词库放入 skills：文件名称不会免除 token 费用。每次发给模型的内容仍参与输入计费；大词库还会挤占上下文。本地确定性匹配免费，AI 请求只包含当前标题、正文、命中项及必要项目事实。本机版在本机检查；完整 Web 版仍遵循浏览器本地加密保存、后端请求内存处理的现有架构。不得把本地保存描述成 AI 服务商完全不接触待处理文本。

## 3. 词库协议

```text
敏感词|处理方式|推荐替换|风险类型
最好|replace|更适合|A
百分百|replace|尽可能|A
第一|rewrite||A
治愈|rewrite||M
根治|rewrite||M
官方认证|rewrite||Q
[笑哭R]|allow||E
❤️|allow||E
```

| 字段 | 含义与限制 |
| --- | --- |
| 敏感词 | 字面匹配，1–60 个 UTF-16 单位；不是正则表达式 |
| 处理方式 | `replace` 固定替换；`rewrite` 上下文改写；`allow` 精确匹配豁免；`semantic` 价格语境识别后用用户指定的词替换 |
| 推荐替换 | 最多 120 个 UTF-16 单位；replace 留空表示删除；rewrite 留空绝不能删除原文 |
| 风险类型 | A 夸张承诺、M 功效表达、Q 资质依据、P 平台表达、E 表情；支持 1–20 位字母、数字、下划线或连字符分类 |
| enabled（可选第五列） | `true` / `false`；导出包含此列，导入四列时默认启用 |

应用内部保存 `{id, term, action, replacement, risk, enabled}`。老词条缺 action 时视为 replace，缺 risk 时视为 A；不覆盖旧替换内容和停用状态，也不恢复被用户清空的词库。

支持 TXT 的竖线分隔和标准 CSV 的逗号分隔；字段含分隔符或双引号时用双引号包裹，内部双引号写两遍。推荐替换与词条不允许换行或 NUL。空行、以 `# ` 开头的说明行忽略。兼容旧格式 `敏感词=替换词`。同一导入文件的重复词条报错；与现有词库同名则保留现有设置并显示跳过数量。无效导入不会写入已保存词库。最多 500 条。

基础词库保留旧版 26 条默认规则，随附 TXT／CSV 包含可选新增 rewrite / allow 示例。升级不自动注入新词覆盖用户偏好；在设置中“补充示例词条”或导入基础词库后保存即可启用。

`template` 动态模板／任意正则替换暂未实现，不应写入支持清单。复杂上下文用 rewrite。

## 4. 编码、Emoji 与位置

- TXT／CSV 使用 UTF-8，支持 BOM；导出带 BOM 和 Windows CRLF。检测到无效 UTF-8 时提示重新保存，不猜测乱码。
- 普通 Unicode Emoji（✨、🔥、✅、❤️）可直接复制。小红书专用表情代码如 `[笑哭R]` 按普通字符串保留；实际显示由平台决定。
- 不自动去除 variation selector、ZWJ 或肤色修饰符，不使用 NFKC 改写原文。`❤️` 不等于 `❤`；允许精确长词不意味着相似词全部允许。
- 匹配采用字面、忽略大小写、长词优先、从左到右、非重叠。允许词只豁免被精确匹配的范围。没有默认中文分词或英文单词边界，因此可能误报。
- 应用 `start` / `end` 为 **UTF-16 半开区间 `[start,end)`**，可直接用于 `String.slice`。Python 返回相同 UTF-16 字段，并额外给出 `startCodePoint` / `endCodePoint`，供 Python 字符串切片。
- 前端高亮使用 React 文本节点，不拼接不可信 HTML。行号和字符位置为人工辅助；组合 Emoji 包含多个码点，不能把码点列号承诺成视觉字符数。

## 5. 目录与职责

```text
skills/
  sensitive-copy-review/SKILL.md
  xiaohongshu-copywriting/SKILL.md
resources/sensitive/
  sensitive_words.txt
  sensitive_words.csv
  sensitive_words_template.txt
  copy_example.txt
scripts/
  compile-copy-skills.mjs
  sensitive_checker.py
server/
  sensitive-checker.mjs          # 纯本地扫描、位置、解析、导出与合并
  workflow.mjs                   # 词库保存、旧数据兼容、固定替换、复检
  copy-skills.generated.mjs      # 构建生成，勿手工修改
  prompts.mjs                    # 按步骤装配技能
  ai.mjs                        # 结构化输出校验、现有模型适配
  ai-routes.mjs                  # 预算、并发锁、版本保护、候选返回
src/
  components/CopyCheckPanel.tsx  # 原文高亮、替换预览、AI 候选、采用
  pages/ContentRules.tsx         # 自定义词库、策略、导入导出、试查
  pages/Corpus.tsx               # 生成检查记录与原文快照
  pages/Studio.tsx               # 编辑与自检入口
tests/sensitive-checker.test.mjs
outputs/ai_copy_sensitive_checker_handoff.md
```

## 6. 关键接口

```javascript
scanText(text, rules, field = 'body') // CopyMatch[]，原文位置
scanCopy({title, body, ...}, rules)   // 限定字段，不修改 facts/corpus/comments
applyFixed(text, matches)            // 从后往前替换，保持原始 offset 有效
parseRules(text, 'txt' | 'csv')      // ContentRule[]；失败抛错
serializeRules(rules, format)        // UTF-8 文本，包含 enabled
mergeRules(existing, incoming)       // {rules, added, skipped}，已有项优先
screenCopy(input, rules)             // {value, review}
```

`CopyMatch` 包含 `ruleId, field, original, replacement, action, risk, start, end, context`。`review` 包含原文快照 `source`、原文位置 `matches`、固定替换汇总 `hits`、修改后位置 `remaining`、`status: clean | needs-review`。clean 只表示本次词库扫描没有残留。

Python 接口：`load_rules(path)`、`scan_text(text,rules,field)`、`apply_fixed(text,matches)`、`check_copy(text,rules)`。

```powershell
python scripts/sensitive_checker.py --rules resources/sensitive/sensitive_words.txt --text resources/sensitive/copy_example.txt --output result.json
```

API：保留 `PUT /api/content-rules` 的 `expectedRevision` 保护。复用 `POST /api/projects/:id/assets/:assetId/copy`，传入 `reviewOnly: true, expectedRevision, rulesRevision, draft: {title,body}`。返回 `{candidate,review,sourceRevision,rulesRevision}`，不直接覆盖成品。`reviewOnly` 分支只接受标题、正文输出，不会重做 prompt/scenes。

使用现有“文案”模型路由、凭证保护、项目预算与费用记录，不新设硬编码模型或明文密钥。OpenAI 和 DeepSeek 都走同一业务流程。普通文案生成仍输出 title/body/prompt/scenes，小红书技能按渠道加载。

## 7. 处理流程

1. 获取当前用户已保存词库与版本。
2. 本地扫描原文，逐处高亮，展示规则及原文位置。
3. replace 生成修改预览；rewrite 原样保留，allow 范围不报命中。
4. 固定替换后重新完整扫描，包括替换与相邻文字拼接后产生的新命中。
5. 用户确认需要 AI 时发送一次请求；只带当前标题、正文、残留项和必要事实，不发送完整词库。确认预算并保留原文。
6. 校验 AI JSON、字段和长度；结果再次固定替换并复检。
7. 返回候选与残留位置。有残留继续标记，调用失败保留原文；不自动重试。
8. 若用户改过文案、规则或成品版本，候选失效。采用到编辑框后仍须保存，保存沿用成品版本检查与历史逻辑。
9. 修改标题后需重新制作画面，导出后自行手动发布。

## 8. MVP 开发清单与验收

- [x] 旧版 26 条词库兼容，基础 TXT／CSV 与扩展示例模板。
- [x] 固定替换、上下文改写、精确允许策略；自定义替换仍可编辑。
- [x] 本地扫描、逐处位置、重复和长词处理、替换后二次扫描。
- [x] 标题／正文高亮、前后预览、生成检查记录。
- [x] UTF-8 导入、错误提示、合并预览、保存版本保护、停用状态往返。
- [x] 小红书写作技能与敏感词审核技能实际进入提示词。
- [x] 单次 AI 改写候选、残留复检、失败不覆盖、版本变动不覆盖。
- [x] 独立 Python CLI；JavaScript / Python 关键位置与输出一致性测试。

验收场景：

1. `✨👩‍💻 最好最好` 两处高亮准确且表情不损坏；固定替换按用户文字执行。
2. `治愈` 配置 rewrite 空替换时绝不被直接删除；AI 返回仍含该词时保留待复核提示。
3. `[笑哭R]`、`❤️` 原样保留；含正则符号的词按字面匹配。
4. TXT／CSV 含分隔符与引号可以往返，停用状态保持；无效、重复或乱码导入不覆盖已保存词库。
5. 老用户自定义文案、停用和清空词库在升级后保持；同名导入不静默覆盖。
6. 模型请求未包含无关词条；开启模型成本确认，格式错误或 API 失败不改原文。
7. AI 结果出现新命中仍能提示；模型调用期间词库版本变化则拒绝采用，费用记录保留。
8. 现有项目、语料、封面、视频、导出、手动发布和用户隔离的回归测试通过。

本次测试使用模拟模型响应，未消耗真实 API 额度。真实语言质量需要用用户实际文案与已配置账户继续抽样评估。图片／视频内部文字没有 OCR 自检，本次只处理文本字段。

## 9. 给 Codex 的继续实施要求

先阅读当前源文件与本交接文档，不重置用户词库、不删除既有项目、不恢复自动投送。保持本地检查免费，不将整份词库加入 prompt，不静默追加付费改写。所有 UI 必须区分原文、固定替换、AI 候选和最终保存。

技能的源文件是上述 SKILL.md；修改后执行 `node scripts/compile-copy-skills.mjs`，检查产物同步。不要仅修改 generated 文件。新增 Python 能力时同步 JavaScript 行为及一致性用例，或明确标记只在独立工具支持的功能。

先完善边界再扩展策略：字段上限、Unicode 位置、重叠、循环和拼接后残留、并发版本、费用与失败保留。不要添加任意正则执行、无上限重试或“保证过审”的产品文案。

验证命令：`pnpm check`、`pnpm build`、`pnpm build:web`；设置 `STUDIO_TEST_PYTHON` 为 Python 可执行文件路径后运行测试可包含 Python 一致性验证。Windows 构建：`pnpm build:windows`，再执行 `node scripts/package-windows.mjs`。涉及发布时另行完成版本说明、源码与安装包核对，不把本地构建误报为已经上传 GitHub。


## 10. v1.3.1 价格语义替换补充

用户要求先识别语义，再改成其自定的同音文字。例如配置 `元|semantic|圆|PRICE`，模型应区分“19.9元起”与“元气满满”。此配置只是示例，不覆盖用户词库。

- 新技能：`skills/price-context-replacement/SKILL.md`，仅判断价格、报价、付款、收费、优惠与购买成本语境。
- 新模块：`server/semantic-replacement.mjs`，提供 `semanticCandidates(draft,rules)`、`semanticResult(draft,rules,decisions)` 和数字保护。
- 词库新增 `action: semantic`。初筛保留原文，不能按 replace 全局替换。替换词必填且不能增删数字。
- 沿用 copy API，传 `reviewOnly:true, reviewMode:'semantic', expectedRevision, rulesRevision, draft`。单次最多 40 处。模型逐条返回 `{id,decision:'replace'|'keep'|'uncertain',reason}`，不得遗漏、重复或虚构 id。
- 模型不接收替换词，不输出改写文案。服务端从当前词库读取映射，仅替换判定 replace 的原文范围；keep 和 uncertain 原样保留，再扫描候选。程序验证数字序列不变，并保留“起”、会员条件等未选中的原文。
- 前端蓝色表示语义候选；独立按钮“AI 识别价格并替换”展示逐处理由与预览。采用前不覆盖原文；规则或文案版本变化阻止使用旧结果。
- 本次编辑期间记住模型明确选择 keep 的位置。关闭后再次字面初筛可能重新标蓝，不能把候选误称为违规。
- Python CLI 仅支持 semantic 本地初筛，不调用模型。replace / rewrite / allow 和导入导出继续兼容。
- 新测试 `tests/semantic-replacement.test.mjs` 覆盖重复词不同判断、数字与限定词、未知位置、超限、版本冲突、OpenAI／DeepSeek、只发送候选、不覆盖原文等。

详细操作见 `docs/UPGRADE-1.3.1.md`。不要把表达替换宣传成保证通过平台审核的功能。
