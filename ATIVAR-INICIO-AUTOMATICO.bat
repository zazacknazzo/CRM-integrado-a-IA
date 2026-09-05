@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-autostart.ps1"
if errorlevel 1 goto :erro
echo Inicio automatico ativado. O backup diario roda dentro do Atende.
exit /b 0
:erro
echo Nao foi possivel ativar o inicio automatico.
exit /b 1
