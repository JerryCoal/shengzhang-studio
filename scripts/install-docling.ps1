param(
  [string]$TargetDirectory = (Join-Path $env:LOCALAPPDATA 'ShengzhangStudio\optional\docling'),
  [string]$Python = 'python',
  [switch]$OfficeOnly
)
$ErrorActionPreference = 'Stop'
$targetPath = [System.IO.Path]::GetFullPath($TargetDirectory)
if ($targetPath -eq [System.IO.Path]::GetPathRoot($targetPath)) { throw 'Choose a dedicated component directory, not a drive root.' }
if ((Test-Path -LiteralPath $targetPath) -and -not (Test-Path -LiteralPath (Join-Path $targetPath 'pyvenv.cfg'))) {
  if ((Get-ChildItem -LiteralPath $targetPath -Force | Measure-Object).Count -gt 0) { throw 'The target must be empty or an existing Docling virtual environment.' }
}
$workerDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop'
$setupScript = Join-Path $workerDirectory 'document-parser-setup.py'
if (-not (Test-Path -LiteralPath $setupScript)) { throw 'The document parser setup file is missing. Keep scripts and desktop folders together.' }
& $Python -c "import sys,struct; assert (3,10) <= sys.version_info[:2] < (3,14) and struct.calcsize('P') == 8, 'Use 64-bit Python 3.10 - 3.13'"
if ($LASTEXITCODE -ne 0) { throw 'Install 64-bit Python 3.10 - 3.13, or pass -Python with its full path.' }
Write-Host 'Creating a dedicated local environment. This does not change your other Python packages.'
& $Python -m venv $targetPath
if ($LASTEXITCODE -ne 0) { throw 'Could not create the component environment.' }
$componentPython = Join-Path $targetPath 'Scripts\python.exe'
$package = if ($OfficeOnly) { 'docling-slim[format-office,convert-core]==2.139.0' } else { 'docling-slim[format-office,format-pdf,convert-core,models-local,feat-ocr-rapidocr-onnx,cli]==2.139.0' }
Write-Host 'Downloading optional open-source components. Full PDF/OCR support needs several GB of disk space.'
& $componentPython -m pip install --disable-pip-version-check $package 'truststore==0.10.4'
if ($LASTEXITCODE -ne 0) { throw 'Component download failed. Check your network and trusted certificates, then run this installer again.' }
if (-not $OfficeOnly) {
  Write-Host 'Downloading official layout, table and Chinese/English OCR model weights. No documents are sent.'
  & $componentPython -X utf8 $setupScript --models (Join-Path $targetPath 'docling-models')
  if ($LASTEXITCODE -ne 0) { throw 'Model download did not complete. Office parsing remains installed; run the installer again to finish PDF support.' }
}
Write-Host ''
Write-Host 'Installation complete. In the Studio document parser settings, select:'
Write-Host $componentPython
Write-Host 'Document processing runs offline. Review extracted text and tables before saving.'
