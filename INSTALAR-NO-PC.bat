@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao foi encontrado.
  echo Instale a versao LTS em https://nodejs.org/ e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

echo Instalando o Atende no PC do salao...
where pnpm >nul 2>nul
if errorlevel 1 call npm install --global pnpm@11.19.0
if errorlevel 1 goto :erro

call pnpm install --frozen-lockfile
if errorlevel 1 goto :erro

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-windows.ps1"
if errorlevel 1 goto :erro

call pnpm db:local
if errorlevel 1 goto :erro

call pnpm build
if errorlevel 1 goto :erro

call "%~dp0ATIVAR-INICIO-AUTOMATICO.bat"

echo.
echo Instalacao concluida.
echo Agora execute ATIVAR-ACESSO-REMOTO.bat e depois INICIAR-ATENDE.bat.
echo.
pause
exit /b 0

:erro
echo.
echo A instalacao nao terminou. Verifique a internet e tente novamente.
echo.
pause
exit /b 1
