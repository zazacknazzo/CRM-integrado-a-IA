@echo off
setlocal
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo Instalando o Cloudflare Tunnel...
  winget install --id Cloudflare.cloudflared --exact --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :erro
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-remote.ps1"
if errorlevel 1 goto :erro
echo.
echo Acesso remoto ativado. Reinicie o Atende para abrir o link.
echo O CRM exigira a senha criada na instalacao.
pause
exit /b 0
:erro
echo Nao foi possivel ativar o acesso remoto.
pause
exit /b 1
