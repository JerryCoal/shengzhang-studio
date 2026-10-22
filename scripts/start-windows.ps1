$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioManifest = Get-Content -LiteralPath (Join-Path $studioRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$studioVersion = [string]$studioManifest.version
if ($studioVersion -notmatch '^\d+\.\d+\.\d+$') { throw '项目版本号无效，无法选择安装包。' }
$studioApp = Join-Path $studioRoot "outputs/windows/Shengzhang-Studio-$studioVersion/ShengzhangStudio.exe"
if (Test-Path -LiteralPath $studioApp) {
  Start-Process -FilePath $studioApp -WorkingDirectory (Split-Path -Parent $studioApp) -WindowStyle Hidden
  exit 0
}
Write-Host "当前源码版本 $studioVersion 尚无对应 Windows 包，未打开旧版本。"
Write-Host "预期位置：$studioApp"
Write-Host '请先完成前端构建，再运行：node scripts/build-windows.mjs'
exit 1
