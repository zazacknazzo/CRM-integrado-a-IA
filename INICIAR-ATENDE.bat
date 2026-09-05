@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Execute INSTALAR-NO-PC.bat primeiro.
  pause
  exit /b 1
)

echo Iniciando o CRM e o WhatsApp do salao com recuperacao automatica...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-supervisor.ps1"

echo.
echo O Atende foi encerrado.
pause
