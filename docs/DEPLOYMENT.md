# 多端部署

## 1. 在这台电脑运行

双击项目根目录 `Start-App.cmd`，默认打开 `http://127.0.0.1:4318`。本机无需 API 密钥即可体验；首次运行所需依赖已经安装。

启动器只处理本机运行。`data/server.log` 和 `data/server-error.log` 保存启动日志。需要修改 `.env` 后重启时，结束此项目的 Node 服务再重新运行启动器；不要结束其他项目进程。

个人 API 密钥在「连接与设置」中加密保存，无需修改 .env。必须以同一 Windows 用户运行服务，详见 [密钥与模型说明](API-AND-MODELS.md)。

## 2. 部署一个共用服务端

**v0.2 范围：个人密钥仅限 Windows 本机配置和调用；远程、Docker 和手机端当前只能使用模板/素材/数据功能，原生设备保险箱待实现。**

同一套 API 和数据库供电脑网页与手机客户端访问。推荐以 HTTPS 域名提供。当前是单用户/单工作区应用，访问密码用于此工作区，不是团队账户系统。

服务器上使用 Node.js 22.13+，安装依赖、构建前端，然后设置 `.env`：

```dotenv
HOST=0.0.0.0
PORT=4318
APP_PASSWORD=设置你自己的至少12位密码
SESSION_SECRET=设置你自己的随机长字符串
ALLOWED_ORIGINS=https://你的域名,capacitor://localhost,https://localhost
```

`pnpm start` 启动服务。使用反向代理提供 HTTPS，将请求转发到服务的 4318 端口。反向代理场景必须将真实前端域名加入 `ALLOWED_ORIGINS`，不要使用通配符。Node 不信任任意来源的代理头。

`HOST` 非回环地址时，启动检查要求至少 12 位工作区密码。登录 token 只放在当前浏览器会话中，7 天过期；服务重启后现有会话失效，需要重新登录。

项目包含 `Dockerfile` 和 `compose.yaml`。可在有 Docker 的环境设置 `.env` 后执行 `docker compose up --build -d`。容器端口仅映射主机回环地址，反向代理再对外提供 HTTPS。数据库存放在命名卷 `studio-data`。**本机无 Docker 环境，容器构建尚未实测**。

备份：设置页可导出全量 JSON；需要数据库级备份时先停止服务，再复制数据库文件及其 SQLite WAL 文件。`data/private/` 是当前 Windows 账户保护的密钥保险箱，应排除在项目备份和对外共享之外；密钥迁移需重新填写。当前只提供备份导出，没有面向用户的恢复导入界面。服务器迁移优先在停机状态复制数据库相关文件。

## 3. PWA：无需应用商店的多端使用

部署完成后，电脑、安卓和 iPhone 浏览器打开同一 HTTPS 地址即可使用。同一工作区数据保存在服务端。

- 桌面：使用浏览器的安装应用入口。
- 安卓：浏览器菜单中安装/添加到主屏幕。
- iPhone：Safari 分享菜单中添加到主屏幕。

项目已提供 manifest、192/512 图标和 service worker。缓存只覆盖应用外壳，离线时不提供业务数据读写。设备具体安装入口需按当前浏览器实际界面确认。

## 4. 安卓原生 App

`android/` 已存在，不必重复运行 `cap add android`。

1. 准备可访问的 HTTPS 服务端，在根目录 `.env` 设置 `VITE_API_BASE_URL=https://你的域名`。
2. 服务端 `ALLOWED_ORIGINS` 加入 `https://localhost`，启用工作区密码。
3. 运行 `pnpm build` 和 `pnpm native:sync`。
4. 用 `pnpm native:open:android` 或 Android Studio 打开 `android/`。
5. 等待 Gradle 同步，在设备/模拟器运行，确认登录、上传、视频编码、ZIP 分享和数据库持久化。
6. 配置自己的 applicationId、签名证书和版本号，再生成 APK/AAB。

当前 applicationId 为 `com.shengzhang.marketing`。文件分享使用应用缓存目录，由 Capacitor Filesystem 和 Share 交给系统分享面板。代码没有把 OpenAI 密钥打包进应用。

环境要求以 [Capacitor 安卓/iOS 官方设置指南](https://capacitorjs.com/docs/getting-started/environment-setup) 为准。本机未安装 Android Studio/SDK，因此目前只完成原生工程生成与资源同步，**未编译 APK/AAB**。

## 5. iOS 原生 App

`ios/` 已存在，不必重复 `cap add ios`。工程使用 Swift Package Manager。

1. 在 Mac 上安装 Node 与依赖，将 `.env` 中 `VITE_API_BASE_URL` 设置为真实 HTTPS 服务。
2. 服务端 `ALLOWED_ORIGINS` 加入 `capacitor://localhost`。
3. 运行 `pnpm build`、`pnpm native:sync`，然后 `pnpm native:open:ios`。
4. Xcode 中选择自己的 Team、Bundle Identifier 和签名配置。
5. 在 iPhone/iPad 上验证文件选择、系统分享、视频合成、后台切换与安全区。
6. 按实际采集和传输的数据完善隐私声明，再进行 TestFlight 和 App Store 审核。

已添加并引用 `PrivacyInfo.xcprivacy`，其中包含 Filesystem 文件时间戳 API 的使用理由；已配置产品图片选择说明。[Filesystem 官方隐私清单要求](https://capacitorjs.com/docs/apis/filesystem)。

本机是 Windows，**未进行 Xcode 编译、签名、TestFlight 或真机测试**。

## 6. 正式平台接入

发布当前通过素材包与人工回填完成。平台授权、应用权限、账号适用性和回调需要单独联调。权限未验证前不得把账号能力标成自动发布/自动评论同步。

后续适配层应保留独立的 submission ID、平台回执、幂等键和核对状态。回执不明时先查状态，再决定重试。手动发布待办不应被统计为自动发布。
