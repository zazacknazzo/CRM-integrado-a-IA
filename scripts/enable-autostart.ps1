$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $startup 'Atende Salao.lnk'))
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $root 'scripts\windows-supervisor.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Atende CRM e WhatsApp do salao'
$shortcut.Save()
Write-Host 'Inicio automatico ativado para este usuario do Windows.' -ForegroundColor Green
