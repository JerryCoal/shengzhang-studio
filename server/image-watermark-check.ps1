param([Parameter(Mandatory = $true)][string]$ImagePath)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$stream = $null
$bitmap = $null

function Write-Result($Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Depth 6 -Compress))
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  function Await-Operation($Operation, [Type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.GetAwaiter().GetResult()
  }

  $language = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -match '^zh(-|$)' } | Sort-Object @{ Expression = { if ($_.LanguageTag -eq 'zh-Hans-CN') { 0 } else { 1 } } } | Select-Object -First 1
  if ($null -eq $language) { Write-Result @{ status = 'unavailable'; reason = 'chinese_unavailable' }; exit 0 }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  if ($null -eq $engine) { Write-Result @{ status = 'unavailable'; reason = 'chinese_unavailable' }; exit 0 }

  $item = Get-Item -LiteralPath $ImagePath
  if ($item.Length -lt 32 -or $item.Length -gt 20971520) { Write-Result @{ status = 'unavailable'; reason = 'invalid_image' }; exit 0 }
  $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($item.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $width = [int]$decoder.PixelWidth
  $height = [int]$decoder.PixelHeight
  $maximum = [Math]::Min(8192, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension)
  if ($width -le 0 -or $height -le 0 -or $width -gt $maximum -or $height -gt $maximum -or ([long]$width * $height) -gt 25165824) {
    Write-Result @{ status = 'unavailable'; reason = 'image_limits' }; exit 0
  }
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $width = [int]$bitmap.PixelWidth
  $height = [int]$bitmap.PixelHeight
  $ocr = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $ocr.Lines) {
    if ([string]::IsNullOrWhiteSpace($line.Text) -or $line.Words.Count -eq 0) { continue }
    $left = [double]::PositiveInfinity; $top = [double]::PositiveInfinity; $right = 0.0; $bottom = 0.0
    foreach ($word in $line.Words) {
      $box = $word.BoundingRect
      $left = [Math]::Min($left, $box.X); $top = [Math]::Min($top, $box.Y)
      $right = [Math]::Max($right, $box.X + $box.Width); $bottom = [Math]::Max($bottom, $box.Y + $box.Height)
    }
    $lines += @{ text = $line.Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top }
    if ($lines.Count -ge 4000) { break }
  }
  Write-Result @{ status = 'ok'; language = $language.LanguageTag; width = $width; height = $height; lines = @($lines) }
} catch {
  # Do not expose OCR text, image bytes, filesystem paths, or exception details.
  Write-Result @{ status = 'unavailable'; reason = 'failed' }
} finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
}
