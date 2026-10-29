[CmdletBinding()]
param([int]$Port = 3000)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  $envFile = Join-Path $projectRoot ".env.local"
  if (-not (Test-Path -LiteralPath $envFile)) { Copy-Item (Join-Path $projectRoot ".env.local.example") $envFile; Write-Host "Created .env.local from the example template." }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([^#][^=]*)=(.*)$') { Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2].Trim() }
  }
  $env:PORT = "$Port"
  if (-not (Test-Path -LiteralPath "node_modules")) { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed." } }
  npm run build; if ($LASTEXITCODE -ne 0) { throw "Build failed." }
  $proc = Start-Process -PassThru -WindowStyle Hidden -FilePath "node" -ArgumentList "server/src/server.js" -WorkingDirectory $projectRoot
  try {
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; Write-Host "Zerosum is running: http://localhost:$Port"; $health | ConvertTo-Json; break } catch { if ($i -eq 29) { throw "Server did not become healthy." } }
    }
    Write-Host "Server process $($proc.Id) is running in the background. Stop it with: Stop-Process -Id $($proc.Id)"
  } catch { if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }; throw }
} finally { Pop-Location }
