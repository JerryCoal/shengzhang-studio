# 生长工作站团队版 1.25.0：主机部署与使用

团队版由一台 Windows 主机运行 Node.js 后端和 Caddy HTTPS 入口，同事通过浏览器进入同一个工作区。它是真实本地服务，数据保存在主机。在线模型仍需要网络和服务商密钥。

团队发布包包含 Node.js、经官方校验和验证的 Caddy 2.11.7、页面、后端和启动/停止脚本。日常使用无需安装 Node.js。个人 Windows 桌面版和团队版分别保存数据。

## 先在主机本地试用

1. 将团队 ZIP 完整解压到普通本地目录，保持整个目录结构。不要放在其他人可改写的公共共享目录。
2. 双击 `Start-Team.cmd`。默认地址是 **https://localhost**，只允许本机连接；同事电脑的 localhost 指向同事自己，不能拿这个地址访问你的主机。
3. 首次启动后，按下一节核验并信任本主机生成的 HTTPS 根证书。启动器不会自动修改系统证书信任。
4. 浏览器打开 https://localhost。主机管理员在 `%LOCALAPPDATA%\ShengzhangStudioTeam\setup.code` 查看首次初始化码，在页面创建首位管理员。不要把初始化码发到公共群或公开网站；初始化成功后该文件会删除。
5. 管理员在团队成员页面创建成员并分配角色。团队模式不提供“选择主机已记住用户就登录”的快捷入口。

主机需保持开机、网络可用、当前 Windows 运行用户保持登录。关闭浏览器不停止服务。此版本提供后台进程启动器，**没有安装 Windows 服务或设置开机自启**。注销 Windows 或重启电脑后需重新运行启动器。

## HTTPS 根证书

Caddy 使用本机私有 CA 为指定主机名或 IP 签发证书。首次启动后根证书在：

```text
%LOCALAPPDATA%\ShengzhangStudioTeam\caddy\pki\authorities\local\root.crt
```

管理员先在主机查看该文件指纹。可在 PowerShell 使用：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "$env:LOCALAPPDATA\ShengzhangStudioTeam\caddy\pki\authorities\local\root.crt"
```

将 **root.crt 公开证书**发给需要连接的同事，通过已确认的沟通渠道核对相同 SHA-256。同事在 Windows 证书导入向导中，选择“当前用户 → 受信任的根证书颁发机构”导入；Firefox 如未使用 Windows 信任库，需在其证书设置中单独导入。导入前确认这是你们自己主机的证书。不要以忽略浏览器证书错误作为长期使用办法。

只分发 `root.crt`，不要分发 `root.key`、整个 `caddy` 目录、`master.key`、`setup.code` 或凭证目录。信任此 CA 的设备会信任它签发的证书，主机证书私钥和数据目录应由指定管理员保管。

## 让同事从局域网访问

主机管理员确认实际内网 IP 或内部域名后，先停止默认本机实例，再**手动**指定地址启动。例如主机实际地址为 `192.168.1.50`：

```powershell
.\scripts\stop-team.ps1
.\scripts\start-team.ps1 -SiteAddress 'https://192.168.1.50' -OpenBrowser
```

也可使用可被所有同事解析到该主机的内部域名，例如 `https://studio.company.internal`。IP/域名必须真实对应这台主机，例子不能直接照抄。端口被占用时，可指定 `https://192.168.1.50:8443`；同事也需完整输入带端口的地址。

指定非 localhost 地址后，Caddy 才监听网络接口，Node 仍只监听 `127.0.0.1:4320`。访问入口与后端允许的来源保持一致；不要让同事直接访问 4320。启动器不开放 Windows 防火墙、不修改路由器、不配置 DNS、不设置公网隧道。若同事无法连接，由主机管理员检查内网连通和该 HTTPS 端口的网络策略。公网部署需要单独规划正式域名、证书、访问范围与主机维护。

每台同事电脑需信任前述根证书。更换内网 IP 后，停止服务并以新地址重启；不要同时使用旧、新两个入口。使用固定内网地址或稳定内部域名更便于日常访问。

可配置参数：

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `-SiteAddress` | `https://localhost` | 同事最终访问的 HTTPS 根地址 |
| `-DataDirectory` | `%LOCALAPPDATA%\ShengzhangStudioTeam` | 团队数据目录 |
| `-BackendPort` | `4320` | Node 回环监听端口，通常无需更改 |
| `-WorkspaceName` | `团队工作区` | 工作区显示名称 |
| `-OpenBrowser` | 不启用 | 成功启动后打开浏览器 |

使用了自定义数据目录时，停止脚本也需带同样的 `-DataDirectory`。不要把数据目录设为旧个人工作区目录。

## 停止、故障和更新

双击 `Stop-Team.cmd`，或运行 `scripts/stop-team.ps1`。脚本会核对本次进程编号、程序绝对路径及启动时间，再向后台发送停止请求；不会按进程名批量结束 Node 或 Caddy。后端等待当前任务结束再关数据库。若提示仍在等待，稍后再次检查，不要重复点击生成。

日志在数据目录的 `logs` 中，包括后端、HTTPS 和启动管理器的标准输出/错误日志。端口冲突、地址配置错误、主密钥无法解锁会在此给出线索。脚本启动前校验 Caddy 配置，启动后用本机 CA 验证 HTTPS 健康接口。不会开启 HTTP 访问日志记录文案和凭证。

更新时先正常停止旧实例，完整解压新包到新目录，再用**同一 Windows 用户、同一数据目录、同一访问地址**启动。无需复制或覆盖旧数据目录。不要同时从两个应用目录启动同一份团队数据。

## 数据和备份

数据目录内包含团队用户、加密工作区数据库、加密凭证保险箱、主密钥、HTTPS CA 与运行记录。`master.key` 在 Windows 上受当前运行用户的 DPAPI 保护；团队成员登录密码用于认证，团队内容统一由主机加密保存。管理员可管理成员权限，但这不是对主机管理员隐藏内容的端到端加密系统。

备份前先正常停止服务，完整备份团队数据目录，包括 `master.key`、SQLite 相关文件、`private` 和 `caddy`。备份放在只有管理员可访问的位置；不要仅备份数据库而漏掉密钥。恢复应优先在原 Windows 用户及其 DPAPI 环境中进行。只将文件复制到另一台电脑或另一个 Windows 用户不能保证解密成功；跨机迁移需另行设计受控导出和重新加密流程，不要删除旧数据或旧 Windows 用户。

现有个人版默认位于 `%LOCALAPPDATA%\ShengzhangStudio`；团队默认位于 `%LOCALAPPDATA%\ShengzhangStudioTeam`。本启动器不会自动合并个人资料、密码或平台登录信息。需要迁移时先备份，使用明确支持的导入流程，核对账号归属后再使用。

## 浏览器功能范围

团队成员共用项目、素材、账号身份和创作方案，操作记录归属到各自登录用户。账号生成身份、发布目标和权限仍需核对。成员角色由管理员管理，密钥维护与实际发布按角色限制。

纯浏览器没有 Electron 桌面能力：不会自动取得每台同事电脑的桌面平台登录状态、内置浏览器会话、桌面发布助手或本机文档解析组件。主机上配置的可用后端能力可以共享；依赖桌面客户端的入口会提示当前环境限制。浏览器选择或拖拽文件会把选中的内容上传到团队主机，而不是保留为仅此浏览器可见的个人素材。

## 构建与来源

开发环境先构建普通前端 `dist`，校验 Skills 和测试，再准备官方 Caddy：

```powershell
node --use-env-proxy scripts/prepare-team-caddy.mjs
node scripts/build-team.mjs
```

打包脚本只收录页面、后端、配置、脚本、运行时、许可证与校验清单；不会复制真实数据、私密目录、初始化码和环境文件。输出为 `outputs/Shengzhang-Studio-Team-版本-windows-x64.zip` 及 SHA-256 文件。构建不会启动服务或部署网络入口。

固定 Caddy 官方发行版：[v2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)。下载脚本核验该发行版公开的 SHA-512，启动器再次核验 `caddy.exe` SHA-256。

配置参考：[反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[本地 TLS](https://caddyserver.com/docs/caddyfile/directives/tls)、[请求体限制](https://caddyserver.com/docs/caddyfile/directives/request_body)、[全局选项和证书信任](https://caddyserver.com/docs/caddyfile/options)、[配置验证命令](https://caddyserver.com/docs/command-line)。
