$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function New-RandomHex([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  -join ($buffer | ForEach-Object { $_.ToString('x2') })
}
function ConvertTo-DotEnvValue([string]$Value) {
  if ($Value.Contains("`r") -or $Value.Contains("`n")) { throw 'Os segredos nao podem conter quebra de linha.' }
  ConvertTo-Json -InputObject $Value -Compress
}
$apiKey = Read-Secret 'Cole a chave da OpenAI (ela ficara oculta)'
$password = Read-Secret 'Crie a senha para acessar o CRM pelo link remoto'
if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($password)) { throw 'A chave da OpenAI e a senha do CRM sao obrigatorias.' }
$sessionSecret = New-RandomHex 32
$backupKey = New-RandomHex 32
@(
  "OPENAI_API_KEY=$(ConvertTo-DotEnvValue $apiKey)"
  'OPENAI_MODEL=gpt-5.6-luna'
  'WHATSAPP_PROVIDER=baileys'
  'APP_URL=http://localhost:3000'
  'MESSAGE_DEBOUNCE_MS=1400'
  'WHATSAPP_WINDOW_HOURS=24'
  'MAX_PROMOTIONAL_FOLLOWUPS=2'
  'FOLLOWUP_LIMIT_WINDOW_DAYS=30'
  "CRM_ACCESS_PASSWORD=$(ConvertTo-DotEnvValue $password)"
  "CRM_SESSION_SECRET=$(ConvertTo-DotEnvValue $sessionSecret)"
  'ALLOW_LOCAL_PASSWORDLESS=false'
  "BACKUP_ENCRYPTION_KEY=$(ConvertTo-DotEnvValue $backupKey)"
) | Set-Content -Encoding utf8 (Join-Path $root '.dev.vars')
Write-Host 'Configuracao privada salva.' -ForegroundColor Green
