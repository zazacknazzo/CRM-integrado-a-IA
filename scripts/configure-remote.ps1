$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType File -Force (Join-Path $root '.remote-access') | Out-Null
$stable = Read-Host 'Voce ja possui um token de Tunnel permanente da Cloudflare? (s/N)'
if ($stable -match '^[sS]') {
  $secure = Read-Host 'Cole o token do Tunnel (ficara oculto)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token vazio.' }
  Set-Content -Encoding utf8 -NoNewline (Join-Path $root '.tunnel-token') $token
  Write-Host 'Link permanente configurado. O endereco e o definido no painel Cloudflare.' -ForegroundColor Green
} else {
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $root '.tunnel-token')
  Write-Host 'Modo rapido ativado. O endereco publico aparecera em logs\tunnel.log e mudara a cada reinicio.' -ForegroundColor Yellow
}
