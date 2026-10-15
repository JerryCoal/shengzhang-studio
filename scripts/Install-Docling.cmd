@echo off
chcp 65001 >nul
echo Shengzhang Studio - Optional local document parser
echo This installer downloads Docling and local PDF/OCR models. Documents are not uploaded.
echo Python 3.10 - 3.13 (64-bit) must already be installed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-docling.ps1" %*
if errorlevel 1 echo Installation did not complete. Existing simple text extraction remains available.
pause
