$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
function Rotate-Log([string]$Path) {
  if ((Test-Path $Path) -and (Get-Item $Path).Length -gt 10MB) {
    $previous = "$Path.1"
    Remove-Item -Force -ErrorAction SilentlyContinue $previous
    Move-Item -Force $Path $previous
  }
}
@('supervisor.log', 'tunnel.log', 'tunnel-error.log', 'atende.log', 'atende-error.log') | ForEach-Object { Rotate-Log (Join-Path $logs $_) }
Set-Location $root
while ($true) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content (Join-Path $logs 'supervisor.log') "$stamp - iniciando Atende"
  $tunnel = $null
  if (Test-Path (Join-Path $root '.remote-access')) {
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if ($cloudflared) {
      if (Test-Path (Join-Path $root '.tunnel-token')) {
        $token = (Get-Content -Raw (Join-Path $root '.tunnel-token')).Trim()
        $tunnel = Start-Process $cloudflared -ArgumentList @('tunnel', 'run', '--token', $token) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'tunnel.log') -RedirectStandardError (Join-Path $logs 'tunnel-error.log')
      } else {
        $tunnel = Start-Process $cloudflared -ArgumentList @('tunnel', '--url', 'http://localhost:3000') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'tunnel.log') -RedirectStandardError (Join-Path $logs 'tunnel-error.log')
      }
    }
  }
  $app = Start-Process 'cmd.exe' -ArgumentList @('/c', 'pnpm whatsapp:web:prod') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'atende.log') -RedirectStandardError (Join-Path $logs 'atende-error.log')
  $app.WaitForExit()
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  Add-Content (Join-Path $logs 'supervisor.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - processo encerrou; reiniciando em 5 segundos"
  Start-Sleep -Seconds 5
}
