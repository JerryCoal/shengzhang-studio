# 五平台账号矩阵与 MCP 接入

核对日期：2026-10-15。先完成服务安装和平台授权，再到工作站「设置 → 账号与发布 → 对应平台」新增连接、保存地址、检查能力和账号状态。工作站不会把“有一个 MCP 地址”当成“已经登录”。

## 能做什么

| 平台 / 服务 | 登录方式 | 本轮接入 | 限制 |
| --- | --- | --- | --- |
| 小红书 `xpzouying/xiaohongshu-mcp` | 官方页面扫码 | 发布、评论、同话题发现 | 保留上一版独立目录、端口、多账号与重启功能 |
| 抖音 `panwenda/douyin-publish-mcp` | 官方页面扫码 | 图文、视频提交 | 该服务本身没有评论和热点工具 |
| 抖音 `ywleeo/browser-mcp` | 自己的 Chrome 登录 | 搜索、详情、评论 | 需要 Chrome 扩展和本机桥接；不提供发布工具 |
| YouTube `prmichaelsen/youtube-mcp` | Google OAuth | 视频上传、评论、关键词与播放量双路搜索 | 需要 Google Cloud 应用、YouTube Data API 和账号授权；使用本文提供的修复入口 |
| Instagram `IvanBBaev/instagram-mcp` | Meta OAuth | 图文/Reels、自己作品评论、标签热门/近期样本 | 需要专业账号；标签发现需要 Facebook Login 路线；不是任意关键词全网搜索 |
| TikTok `thenavidm/tiktok-mcp-cli` | TikTok OAuth | 账号检查、图文/视频提交 | 此项目没有评论读取或全网热点搜索，不会显示为已实现 |

三个海外服务都不是小红书式扫码。它们使用对应平台的开发者应用和 OAuth 授权，不需要把平台密码、Cookie 发给工作站或开发者。安装开源软件与平台给你发布/读取权限是两件事。

工作站中的 AI API 密钥、MCP 访问令牌继续进入本机加密保险箱。**外部 MCP 的 OAuth 文件由外部项目自行保存，部分是本机明文文件；这不等于工作站已经替它加密。** 将它们放在自己的 Windows 用户目录中，限制目录访问，不要放进同步盘、素材导出包或 GitHub。

## 账号归属

1. 为每个平台账号建立独立的连接名称，例如「校园号 A」「品牌主号」。
2. 为运营账号选择对应的 MCP 连接，发布和评论记录继续归到运营账号。
3. 同一服务内部管理多个账号时，在工作站填写服务自己的 `account` 名称；Instagram 与 TikTok 都使用此字段。工作站连接名称和平台实际账号不是同一个字段。
4. YouTube 使用一套授权目录对应一个独立端口。不要让两个本机服务共用 `tokens.json`。
5. 抖音 Browser MCP 使用配对的 Chrome Profile。不同平台账号应使用不同 Chrome Profile、桥接配置和端口；不能把同一个已登录浏览器连接命名两次就称作两个账号。

平台可主动使登录过期。连接保存可以避免重复配置，不能保证 OAuth 或 Cookie 永久有效。切换连接后需要重新核对当前账号。

## 准备环境

- 海外服务：安装 [Node.js 22 或更新版本](https://nodejs.org/)，命令示例使用 Windows PowerShell。
- YouTube 的源码下载步骤使用 `git clone`，请先安装 [Git for Windows](https://git-scm.com/download/win)，再重新打开 PowerShell。
- 抖音采集：还需要 [Python 3.12 或更新版本](https://www.python.org/downloads/windows/) 与 Google Chrome。
- 本文路径 `C:\MCP` 是示例，请换成自己的目录。每次安装固定本文核对版本；升级上游前重新检查能力。
- 本机服务仅绑定 `127.0.0.1`。不要开放到公网，也不要把 Windows 防火墙改为允许外网访问。

## Instagram：建议先接通账号和自有评论

参考项目：[IvanBBaev/instagram-mcp](https://github.com/IvanBBaev/instagram-mcp)，实测安装版本 `instagram-mcp-ai@0.8.0`。

1. 将 Instagram 账号切换为 Business 或 Creator，按照 [Meta Instagram Platform 文档](https://developers.facebook.com/docs/instagram-platform/) 创建开发者应用并配置所需权限。
2. 只需要自己内容的发布与评论，可用 Instagram Login。需要标签发现则选择 Facebook Login 路线，配置关联的 Facebook Page / Instagram 专业账号和相应权限。
3. 建立自己的服务文件夹，安装固定版本：

```powershell
New-Item -ItemType Directory -Force C:\MCP\instagram
Set-Location C:\MCP\instagram
npm install --ignore-scripts instagram-mcp-ai@0.8.0
```

4. 在此目录创建 `account.env`，先保存从 Meta 应用取得的 `IG_APP_ID` 与 `IG_APP_SECRET`。不要把真实值写进本文档或截图。
5. 使用该服务的授权助手。先运行帮助查看回调地址与账号参数，将实际回调地址加入 Meta 应用配置：

```powershell
$env:IG_ENV_FILE='C:\MCP\instagram\account.env'
node --env-file=account.env node_modules/instagram-mcp-ai/dist/src/index.js login --help
node --env-file=account.env node_modules/instagram-mcp-ai/dist/src/index.js login --path fb
```

授权会在浏览器中完成；授权助手将令牌写回自己的本机文件。若使用 Instagram Login，将 `--path fb` 改为 `--path ig`，同时不要期待标签发现能力。

6. 在 `account.env` 增加以下启动配置。`IG_HTTP_TOKEN` 填自己生成的随机长字符串，随后在工作站的 MCP 令牌框填写相同值：

```dotenv
IG_TRANSPORT=http
IG_HTTP_HOST=127.0.0.1
IG_PORT=18130
IG_TOOL_PACKAGES=all
IG_WRITE_MODE=preview
IG_HTTP_TOKEN=替换为至少24位随机访问令牌
```

7. 启动服务并保持运行：

```powershell
node --env-file=account.env node_modules/instagram-mcp-ai/dist/src/index.js
```

8. 工作站填写 `http://127.0.0.1:18130/mcp`，检查连接与账号。服务只有 `core` 工具包时不会出现标签发现，因此上述 `IG_TOOL_PACKAGES=all` 不能遗漏。

发布时需填写平台可直接读取的公开 HTTPS 图片或视频地址；本机 `D:\素材.mp4`、网盘预览页都不是可读取的文件 URL。图片需符合 Meta 的 JPEG 等素材约束，工作站会要求你核对链接与预览是同一素材。MCP 返回 `in_progress` 时仍在处理，不会当作已经公开发布。

多账号可采用“一账号一目录、一端口”；或按上游命名 profile 配置，在工作站「服务内账号」填写对应名称。服务内参数实际为 `account`。

## TikTok：接通授权，再准备发布

参考项目：[thenavidm/tiktok-mcp-cli](https://github.com/thenavidm/tiktok-mcp-cli)，实测版本 `2.0.1`。

```powershell
New-Item -ItemType Directory -Force C:\MCP\tiktok
Set-Location C:\MCP\tiktok
npm install --ignore-scripts @thenavidm/tiktok-mcp-cli@2.0.1
```

1. 在 [TikTok for Developers](https://developers.tiktok.com/) 创建应用，配置 Login Kit、Display API；需要提交内容再申请 Content Posting API 及对应范围。
2. 在 `account.env` 写入自己的 `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`。在平台登记与服务相同的回调地址，当前默认 `http://127.0.0.1:8481/callback/`，包括末尾斜杠。
3. 运行授权助手，在系统浏览器授权：

```powershell
node --env-file=account.env node_modules/@thenavidm/tiktok-mcp-cli/dist/index.js login --publish
```

上游助手会显示刷新令牌。只在本机将其保存为 `account.env` 的 `TIKTOK_REFRESH_TOKEN`，不要贴到聊天或工作站的 DeepSeek/Qwen 密钥框里。纯读取授权可不带 `--publish`。

4. 增加启动配置，然后保持服务运行：

```dotenv
TIKTOK_HTTP_HOST=127.0.0.1
TIKTOK_HTTP_TOKEN=替换为至少24位随机访问令牌
TIKTOK_SURFACE=full
```

```powershell
node --env-file=account.env node_modules/@thenavidm/tiktok-mcp-cli/dist/index.js --http --port 18140
```

5. 工作站地址为 `http://127.0.0.1:18140/mcp`，令牌填写上面的 HTTP 令牌。首次点击检查账号，然后在投稿窗口点击「读取账号与发布权限」。
6. 手动选择可见范围、互动选项、商业内容和 AI 声明，并核对目标昵称、素材与音乐使用确认。当前适配项目只支持通过公开媒体 URL 提交，域名须先通过 TikTok 验证；上传本机文件不会被偷偷转存到陌生图床。

官方 [Direct Post 文档](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post) 说明未审核应用受私密发布限制。[使用规范](https://developers.tiktok.com/docs/en/content-sharing-guidelines) 也说明只供自己/团队账号上传的内部工具不属于其公开 Direct Post 审核目标。工作站的接入不代表已经替你取得审核许可。

这个 MCP 没有评论读取与全网关键词搜索。其 `search_my_videos` 和 `top_videos` 只分析授权账号自己的作品，不能当作竞品热点。需要评论时保留手工导入；没有另加一个收费采集 API 来冒充官方能力。

## YouTube：使用修复后的工作站入口

参考项目：[prmichaelsen/youtube-mcp](https://github.com/prmichaelsen/youtube-mcp)，核对提交 `f0175a41dbdf252e39e110de1c4ca133f9beb1b6`。

审查发现该提交的原始 CLI 调用 `createServer()` 时没有传 OAuth 对象，因此不会注册工具；原 HTTP transport 也不适合工作站反复新建会话。这里提供独立入口和桥接，不需要修改原作者文件。

1. 建立 [Google Cloud 项目](https://console.cloud.google.com/)，启用 YouTube Data API v3，配置 OAuth 同意屏幕、测试用户及 Desktop OAuth 客户端。参考 [Google 桌面应用 OAuth 文档](https://developers.google.com/identity/protocols/oauth2/native-app)。
2. 下载固定代码、安装依赖：

```powershell
git clone https://github.com/prmichaelsen/youtube-mcp.git C:\MCP\youtube
Set-Location C:\MCP\youtube
git checkout f0175a41dbdf252e39e110de1c4ca133f9beb1b6
npm install --ignore-scripts
npm install --ignore-scripts gaxios@7.1.3
```

3. 用本工作站附带的 `scripts/prepare-youtube-mcp.mjs` 创建入口（将前半段路径换成实际位置），再构建：

```powershell
node E:\MVP-运营助手\scripts\prepare-youtube-mcp.mjs --repo C:\MCP\youtube
node node_modules/esbuild/bin/esbuild src/studio-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/studio-entry.js
```

4. 创建 `C:\MCP\youtube\account.env`，填写自己 OAuth 客户端信息和独立令牌目录：

```dotenv
GOOGLE_CLIENT_ID=你的Google客户端ID
GOOGLE_CLIENT_SECRET=你的Google客户端Secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:18111/callback
TOKEN_STORAGE_PATH=C:/MCP/youtube/account-a-tokens
```

5. 授权：

```powershell
node --env-file=account.env dist/studio-entry.js --login
```

在浏览器打开显示的 Google 官方链接并授权；回调成功后令牌保存在指定本机目录，不会在本入口输出。若收到 Google 的测试用户/应用验证提示，需到自己的应用配置里处理，不能靠 MCP 绕过。

6. 复制附带的 `youtube.bridge.example.json` 为自己的配置，改成真实 `node.exe`、源码路径和环境文件路径，然后按下节启动桥接。默认示例端口 `18120`，工作站填 `http://127.0.0.1:18120/mcp`。

评论获取核对 videoId，搜索先取相关内容和高播放候选，再读取官方作品统计。评论线程可能不含全部回复，界面会保留采样说明。API 配额由 Google 项目管理，不等于无限免费调用。参考 [YouTube 评论接口](https://developers.google.com/youtube/v3/docs/commentThreads/list) 与 [搜索接口](https://developers.google.com/youtube/v3/docs/search/list)。

## 抖音评论与话题：Chrome + Browser MCP

参考项目：[ywleeo/browser-mcp](https://github.com/ywleeo/browser-mcp)，核对 `0.15.0` / 提交 `5a17892ff945265e12d60ed78f5e4d2ccfea1b75`。

```powershell
py -3.12 -m venv C:\MCP\douyin-reader\.venv
C:\MCP\douyin-reader\.venv\Scripts\python.exe -m pip install ai-browser-mcp==0.15.0
```

1. 复制 `douyin-reader.bridge.example.json`，改成自己的 Python、工作目录及 `BROWSER_MCP_DATA_DIR`。不同账号要不同目录与端口。
2. 启动桥接，在 Chrome `chrome://extensions` 开启开发者模式并加载上游扩展。安装后的扩展目录可通过下面的状态助手获取：

```powershell
node E:\MVP-运营助手\scripts\matrix-browser-status.mjs --endpoint http://127.0.0.1:18150/mcp
```

若设置桥接 token，状态助手从环境变量 `STUDIO_MCP_BRIDGE_TOKEN` 读取，不在 URL 或命令参数中传令牌。

3. 在这个 Chrome Profile 登录自己的抖音账号。工作站选择「抖音」外部 MCP，填桥接地址并检查能力。
4. 在话题发现选择抖音与关键词；在已登记自有作品的评论页选择采集。遇到平台登录、验证码或页面变化需要自己在 Chrome 完成；程序不绕过这些步骤。

该服务读取浏览器页面及页面自己的请求结果，页面变化会影响适配。它不提供抖音发布工具；已有 `panwenda/douyin-publish-mcp` 继续负责投稿。同一个抖音账号连接中，主地址填写发布服务，选填的采集地址填写 Browser MCP 桥接地址，并单独保存采集令牌。两边都应登录同一个平台账号，工作站会把评论与样本归到同一运营账号。

## 本机 stdio 桥接的启动方式

桥接只解决服务通信方式，不会替你安装服务或创建平台权限。附带 JSON 模板使用绝对路径，启动参数不能来自网络请求。

```powershell
node E:\MVP-运营助手\scripts\start-matrix-mcp.mjs --config C:\MCP\youtube\bridge.json
```

显示本机地址后保持此进程运行。Windows 安装包中的本说明位于 `多平台MCP\README.md`，脚本位于 `多平台MCP\scripts`，配置模板位于 `多平台MCP\examples`。在解压后的 `多平台MCP` 文件夹中打开 PowerShell，可直接使用随包 Node 启动桥接：

```powershell
..\resources\runtime\node.exe .\scripts\start-matrix-mcp.mjs --config C:\MCP\youtube\bridge.json
```

同理可调用 `prepare-youtube-mcp.mjs` 和 `matrix-browser-status.mjs`。模板的 `command` 也可改为 `resources\runtime\node.exe` 的绝对路径。首次安装第三方 npm 包仍需前文的 Node/npm 环境。

桥接只监听 `127.0.0.1`，拒绝网页 Origin 调用；可在自己配置里加入至少 24 位随机 `token`，并填到工作站 MCP 访问令牌中。每次连接建立独立子进程，关闭后结束；登录资料由你指定的服务目录保存。不要在 JSON 中写任何来自帖子或评论的命令。

## 真实验证范围与交接

- 本轮使用隔离目录和虚构凭据，实际启动固定版本 Instagram、TikTok MCP，以及修复入口的 YouTube MCP，检查握手、工具列表、参数能力识别；没有调用真实账号 API 或执行发布。
- 自动测试覆盖跨作品拒绝、分页、账号绑定参数、缺失指标、TikTok 发布必填选项，以及真实本机 HTTP → stdio 的多次连接与隔离。
- 真实 OAuth、平台权限、素材域名、发布与评论返回仍需在使用者自己的账号上验证。能力显示为“有工具”不能代替“该账号有权限”。
- 工作站源码只实现兼容适配和独立桥接，没有把这些外部项目源码直接打进安装包。上游项目按各自许可独立安装；不下载、打包或共享用户的 Cookie / OAuth 文件。

代码审查重点：YouTube `src/server.ts`、`src/auth/oauth.ts`、`src/tools/{search,videos,comment-threads}.ts`；Instagram `src/tools/{publishing,comments,discovery}.ts`、`src/mcp/registry.ts`；TikTok `src/tools/{accounts,publish,videos}.ts`；Browser MCP `src/browser_mcp/mcp/server.py`、`sites/douyin.py`。不是仅根据 README 的功能清单判断可用性。
