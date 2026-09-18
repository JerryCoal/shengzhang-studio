$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioApp = Join-Path $studioRoot 'outputs/windows/Shengzhang-Studio-1.0.0/ShengzhangStudio.exe'
if (Test-Path -LiteralPath $studioApp) {
  Start-Process -FilePath $studioApp -WorkingDirectory (Split-Path -Parent $studioApp) -WindowStyle Hidden
  exit 0
}
Write-Host '请先下载并解压 Windows 完整版，或在开发环境运行构建。'
Write-Host '当前项目的打包入口：node scripts/build-windows.mjs'
exit 1
