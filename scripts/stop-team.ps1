param([string]$DataDirectory = '')
$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:LOCALAPPDATA 'ShengzhangStudioTeam' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$studioRun = Join-Path $DataDirectory 'run'
$studioLaunchFile = Join-Path $studioRun 'launcher.json'
if (-not (Test-Path -LiteralPath $studioLaunchFile)) { Write-Host '未找到此数据目录的运行记录。'; exit 0 }
$studioLaunch = Get-Content -LiteralPath $studioLaunchFile -Raw -Encoding UTF8 | ConvertFrom-Json
$studioProcess = Get-Process -Id ([int]$studioLaunch.pid) -ErrorAction SilentlyContinue
if (-not $studioProcess) { Write-Host '团队服务已停止。'; exit 0 }
if ($studioProcess.Path -ne [IO.Path]::GetFullPath($studioLaunch.executable) -or $studioProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $studioLaunch.startTicks) { throw '进程身份与本服务记录不一致，没有停止任何进程。' }
$studioStatus = Get-Content -LiteralPath (Join-Path $studioRun 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$studioStatus.pid -ne [int]$studioLaunch.pid -or $studioStatus.executable -ne $studioLaunch.executable -or $studioStatus.token -notmatch '^[0-9a-f]{64}$') { throw '服务控制记录不匹配，没有停止任何进程。' }
[IO.File]::WriteAllText((Join-Path $studioRun 'stop.request'), $studioStatus.token, [Text.UTF8Encoding]::new($false))
for ($studioAttempt=0; $studioAttempt -lt 100; $studioAttempt++) {
  Start-Sleep -Milliseconds 200; $studioProcess.Refresh()
  if ($studioProcess.HasExited) { Write-Host '团队服务已停止，数据已保留。'; exit 0 }
}
Write-Host '服务正在等待当前任务完成后退出。请稍后再次检查；未强制中断生成任务。'
