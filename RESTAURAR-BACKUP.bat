@echo off
setlocal
cd /d "%~dp0"
echo Feche o Atende antes de restaurar.
set /p BACKUP_NAME="Nome da pasta dentro de backups: "
if "%BACKUP_NAME%"=="" exit /b 1
call pnpm restore -- "%~dp0backups\%BACKUP_NAME%"
pause
