param(
  [string]$SiteAddress = 'https://localhost',
  [string]$DataDirectory = '',
  [ValidateRange(1024,65535)][int]$BackendPort = 4320,
  [string]$WorkspaceName = '团队工作区',
  [string]$NodePath = '',
  [string]$CaddyPath = '',
  [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$studioUri = [Uri]$SiteAddress
if (-not $studioUri.IsAbsoluteUri -or $studioUri.Scheme -ne 'https' -or $studioUri.UserInfo -or $studioUri.Query -or $studioUri.Fragment -or $studioUri.AbsolutePath -ne '/' -or $studioUri.Host -match '[^a-zA-Z0-9.:-]') { throw '访问地址需为 https://主机名或IP，可带端口，不能带路径、参数或密码。' }
$SiteAddress = $studioUri.GetLeftPart([UriPartial]::Authority)
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:LOCALAPPDATA 'ShengzhangStudioTeam' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
if ($DataDirectory -eq [IO.Path]::GetPathRoot($DataDirectory)) { throw '数据目录不能是磁盘根目录。' }
if (-not $NodePath) { $NodePath = Join-Path $studioRoot 'runtime/node.exe'; if (-not (Test-Path -LiteralPath $NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source } }
if (-not $CaddyPath) { $CaddyPath = Join-Path $studioRoot 'runtime/caddy.exe'; if (-not (Test-Path -LiteralPath $CaddyPath)) { $CaddyPath = Join-Path $studioRoot '.tools/team-runtime/caddy.exe' } }
$NodePath = [IO.Path]::GetFullPath($NodePath); $CaddyPath = [IO.Path]::GetFullPath($CaddyPath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw '缺少 Node.js，请使用包含 runtime/node.exe 的完整团队包。' }
if (-not (Test-Path -LiteralPath $CaddyPath -PathType Leaf)) { throw '缺少已校验的 Caddy。开发环境先运行 node --use-env-proxy scripts/prepare-team-caddy.mjs，或使用完整团队发布包。' }
if (-not (Test-Path -LiteralPath (Join-Path $studioRoot 'server/team.mjs'))) { throw '团队后端文件不完整。' }
if (-not (Test-Path -LiteralPath (Join-Path $studioRoot 'dist/index.html'))) { throw '未找到页面文件 dist/index.html，请先构建前端。' }
$studioNodeVersion = & $NodePath -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$studioNodeVersion -lt [version]'24.5.0') { throw '团队服务启动器需要 Node.js 24.5 或更新版本，完整团队包已附带。' }
$studioHashAlgorithm = [Security.Cryptography.SHA256]::Create()
$studioHashStream = [IO.File]::OpenRead($CaddyPath)
try { $studioCaddyHash = [BitConverter]::ToString($studioHashAlgorithm.ComputeHash($studioHashStream)).Replace('-','').ToLowerInvariant() }
finally { $studioHashStream.Dispose(); $studioHashAlgorithm.Dispose() }
if ($studioCaddyHash -ne '5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a') { throw 'Caddy 文件校验失败，请重新解压完整团队包。' }
$studioCaddyVersion = & $CaddyPath version
if ($LASTEXITCODE -ne 0 -or $studioCaddyVersion -notmatch '^v2\.11\.7\b') { throw '请使用本包校验过的 Caddy v2.11.7。' }
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
$studioResolved = (Get-Item -LiteralPath $DataDirectory).FullName
if ($studioResolved -ne $DataDirectory -or (Get-Item -LiteralPath $DataDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '数据目录必须为指定的普通本地目录，不能是链接。' }
$studioSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $DataDirectory /inheritance:r /grant:r "*${studioSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法保护团队数据目录权限，未启动服务。' }
$studioRun = Join-Path $DataDirectory 'run'; $studioLogs = Join-Path $DataDirectory 'logs'
New-Item -ItemType Directory -Path $studioRun,$studioLogs,(Join-Path $DataDirectory 'caddy') -Force | Out-Null
$studioLaunchFile = Join-Path $studioRun 'launcher.json'
if (Test-Path -LiteralPath $studioLaunchFile) {
  $studioOld = Get-Content -LiteralPath $studioLaunchFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $studioExisting = Get-Process -Id ([int]$studioOld.pid) -ErrorAction SilentlyContinue
  if ($studioExisting) {
    if ($studioExisting.Path -eq $studioOld.executable -and $studioExisting.StartTime.ToUniversalTime().Ticks.ToString() -eq $studioOld.startTicks) { Write-Host ('团队服务已经运行：' + $studioOld.origin); exit 0 }
    throw '运行记录对应其他进程，未启动或停止任何进程。请核对数据目录。'
  }
}
$studioLockFile = Join-Path $studioRun 'supervisor.lock'
if (Test-Path -LiteralPath $studioLockFile) {
  $studioLockPid = [int](Get-Content -LiteralPath $studioLockFile -Raw -Encoding UTF8)
  if (Get-Process -Id $studioLockPid -ErrorAction SilentlyContinue) { throw '此目录已有服务进程或正在启动，请先用 stop-team.ps1 检查停止。' }
}
$studioLaunchLock = [IO.File]::Open((Join-Path $studioRun 'launch.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
foreach ($studioStale in @('supervisor.lock','stop.request','status.json','launcher.json')) { $studioStalePath = Join-Path $studioRun $studioStale; if (Test-Path -LiteralPath $studioStalePath) { Remove-Item -LiteralPath $studioStalePath } }
$env:STUDIO_TEAM_DATA_DIR = $DataDirectory
$env:STUDIO_TEAM_ORIGIN = $SiteAddress
$env:STUDIO_TEAM_PORT = $BackendPort.ToString()
$env:STUDIO_TEAM_WORKSPACE = $WorkspaceName
$env:STUDIO_STATIC_DIR = Join-Path $studioRoot 'dist'
$env:STUDIO_TEAM_CADDY_EXE = $CaddyPath
$env:STUDIO_TEAM_CADDY_STORAGE = (Join-Path $DataDirectory 'caddy').Replace('\','/')
$env:STUDIO_TEAM_BIND = if ($studioUri.Host -in @('localhost','127.0.0.1','::1')) { '127.0.0.1' } else { '0.0.0.0' }
$studioConfigArgument = '"' + (Join-Path $studioRoot 'config/Caddyfile.team') + '"'
$studioValidator = Start-Process -FilePath $CaddyPath -ArgumentList @('validate','--config',$studioConfigArgument,'--adapter','caddyfile') -WorkingDirectory $studioRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $studioLogs 'caddy-validate.stdout.log') -RedirectStandardError (Join-Path $studioLogs 'caddy-validate.stderr.log')
if ($studioValidator.ExitCode -ne 0) { throw ('HTTPS 配置未通过检查，请查看 ' + (Join-Path $studioLogs 'caddy-validate.stderr.log')) }
$studioProcess = Start-Process -FilePath $NodePath -ArgumentList @('--use-env-proxy','scripts/team-supervisor.mjs') -WorkingDirectory $studioRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $studioLogs 'supervisor.stdout.log') -RedirectStandardError (Join-Path $studioLogs 'supervisor.stderr.log')
@{ pid=$studioProcess.Id; executable=$NodePath; startTicks=$studioProcess.StartTime.ToUniversalTime().Ticks.ToString(); origin=$SiteAddress } | ConvertTo-Json | Set-Content -LiteralPath $studioLaunchFile -Encoding UTF8
$studioReady = $false
for ($studioAttempt=0; $studioAttempt -lt 100; $studioAttempt++) {
  Start-Sleep -Milliseconds 200
  $studioProcess.Refresh()
  if ($studioProcess.HasExited) { throw ('团队服务启动失败，请查看 ' + $studioLogs) }
  $studioStatusFile = Join-Path $studioRun 'status.json'
  if (Test-Path -LiteralPath $studioStatusFile) {
    try { $studioStatus = Get-Content -LiteralPath $studioStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    if ($studioStatus.status -eq 'running') { $studioReady = $true; break }
    if ($studioStatus.status -eq 'failed') { throw ('团队服务启动失败：' + $studioStatus.failure) }
  }
}
if (-not $studioReady) { throw ('启动尚未完成，请检查日志；不要重复启动。日志：' + $studioLogs) }
Write-Host ('团队服务已在后台运行：' + $SiteAddress)
Write-Host ('数据目录：' + $DataDirectory)
Write-Host ('首次管理员初始化码位于：' + (Join-Path $DataDirectory 'setup.code'))
Write-Host ('HTTPS 根证书位于：' + (Join-Path $DataDirectory 'caddy/pki/authorities/local/root.crt'))
Write-Host '请按部署说明核验并信任根证书，再打开页面。关闭浏览器不会停止服务；停止请运行 scripts/stop-team.ps1。'
if ($OpenBrowser) { Start-Process -FilePath $SiteAddress -WindowStyle Hidden }
} finally { $studioLaunchLock.Dispose() }
