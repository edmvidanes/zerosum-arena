<#
.SYNOPSIS
  One-shot Google sign-in setup for ZeroSum Arena.

.DESCRIPTION
  Run this script and just answer the prompts. It will:
    1. Ask for your Google OAuth Client ID (the only thing you must get from
       Google Cloud Console - see the link it prints if you don't have one).
    2. Save it to .env.local so local runs show the Google button too.
    3. Optionally deploy the latest code to EC2 (needed the first time,
       because the Google sign-in code must reach the server).
    4. SSH into EC2, write GOOGLE_CLIENT_ID into /etc/zerosum/zerosum.env
       (with a timestamped backup), and recreate the app container so it
       picks up the new value.
    5. Verify https://zerosum.website/api/config now advertises the ID.

  No client secret is needed: ZeroSum uses Google Identity Services ID
  tokens, and the Client ID is public (it is visible in the page source).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-google-signin.ps1

.EXAMPLE
  # Non-interactive / repeat run (code already deployed):
  .\scripts\setup-google-signin.ps1 -GoogleClientId "1234.apps.googleusercontent.com" -SkipDeploy
#>
[CmdletBinding()]
param(
  [string]$GoogleClientId,
  [string]$Ec2Host = "zerosum.website",
  [string]$KeyPath,
  [string]$RemoteUser = "ec2-user",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-WithDefault([string]$Label, [string]$Default) {
  $answer = Read-Host "$Label [$Default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim()
}

function Set-EnvFileValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = @(Get-Content -LiteralPath $Path)
  $found = $false
  $updated = $lines | ForEach-Object {
    if ($_ -match "^\s*$Name=") { $found = $true; "$Name=$Value" } else { $_ }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

Write-Host ""
Write-Host "=== ZeroSum Arena - Google sign-in setup ===" -ForegroundColor Cyan
Write-Host "Don't have a Client ID yet? Create one (free, ~2 minutes):"
Write-Host "  https://console.cloud.google.com/apis/credentials"
Write-Host "  Create credentials > OAuth client ID > Web application"
Write-Host "  Authorized JavaScript origins: https://zerosum.website , https://www.zerosum.website , http://localhost:3000 , http://localhost:5173"
Write-Host "  (No redirect URI and no client secret are needed.)"
Write-Host ""

# --- 1. Google Client ID (the one required input) ---------------------------
while ([string]::IsNullOrWhiteSpace($GoogleClientId) -or $GoogleClientId -notmatch '^[\w\-]+\.apps\.googleusercontent\.com$') {
  if (-not [string]::IsNullOrWhiteSpace($GoogleClientId)) {
    Write-Host "That doesn't look like a Client ID - it should end in .apps.googleusercontent.com" -ForegroundColor Yellow
  }
  $GoogleClientId = (Read-Host "Paste your Google Client ID").Trim().Trim('"').Trim("'")
}
Write-Host "Client ID: $GoogleClientId" -ForegroundColor Green

# --- 2. EC2 connection details (defaults usually just work) -----------------
$Ec2Host = Read-WithDefault "EC2 host" $Ec2Host
$RemoteUser = Read-WithDefault "SSH user" $RemoteUser
if ([string]::IsNullOrWhiteSpace($KeyPath)) {
  $guessedKey = Join-Path (Split-Path -Parent (Split-Path -Parent $projectRoot)) "ZeroSumProd.pem"
  if (Test-Path -LiteralPath $guessedKey) { $KeyPath = $guessedKey }
}
if ([string]::IsNullOrWhiteSpace($KeyPath) -or -not (Test-Path -LiteralPath $KeyPath)) {
  $KeyPath = (Read-Host "Path to your EC2 .pem key file").Trim().Trim('"')
}
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Key file not found: $KeyPath" }
Write-Host "Server: $RemoteUser@$Ec2Host  (key: $KeyPath)"

# --- 3. Save the ID locally too ---------------------------------------------
$localEnv = Join-Path $projectRoot ".env.local"
if (Test-Path -LiteralPath $localEnv) {
  Set-EnvFileValue $localEnv "GOOGLE_CLIENT_ID" $GoogleClientId
  Write-Host "Saved GOOGLE_CLIENT_ID to .env.local (for local runs via scripts\run-local.ps1)."
} else {
  Write-Host "No .env.local found - skipping local config. Add GOOGLE_CLIENT_ID=$GoogleClientId to it after scripts\run-local.ps1 creates it."
}

# --- 4. Test the SSH connection before doing anything slow -------------------
Write-Host ""
Write-Host "Testing SSH connection..."
& ssh -i $KeyPath -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$RemoteUser@$Ec2Host" "echo ssh-ok"
if ($LASTEXITCODE -ne 0) {
  throw "SSH failed. Common fixes: accept the host-key prompt once by running: ssh -i `"$KeyPath`" $RemoteUser@$Ec2Host  |  If Windows says the key is too open, run: icacls `"$KeyPath`" /inheritance:r /grant:r `"%USERNAME%:R`"  |  Check your current IP is allowed on port 22 in the EC2 security group."
}

# --- 5. Deploy the latest code (first run needs the new Google auth code) ----
if (-not $SkipDeploy) {
  $deploy = Read-WithDefault "Deploy the latest code to EC2 first? (required unless already deployed) [Y/n]" "Y"
  if ($deploy -notmatch '^(n|no)$') {
    Write-Host "Deploying (this runs tests + build, then installs on EC2)..."
    & (Join-Path $PSScriptRoot "deploy-docker.ps1") -Ec2Host $Ec2Host -KeyPath $KeyPath -RemoteUser $RemoteUser
    if ($LASTEXITCODE -ne 0) { throw "Deployment failed - Google config was NOT changed on the server." }
  }
}

# --- 6. Write GOOGLE_CLIENT_ID on the server and recreate the app -----------
Write-Host ""
Write-Host "Configuring Google sign-in on $Ec2Host ..."
$remoteCommand = @"
set -e
sudo cp /etc/zerosum/zerosum.env "/etc/zerosum/zerosum.env.bak.`$(date +%Y%m%d%H%M%S)"
if sudo grep -q '^GOOGLE_CLIENT_ID=' /etc/zerosum/zerosum.env; then
  sudo sed -i 's|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=$GoogleClientId|' /etc/zerosum/zerosum.env
else
  echo 'GOOGLE_CLIENT_ID=$GoogleClientId' | sudo tee -a /etc/zerosum/zerosum.env >/dev/null
fi
cd /opt/zerosum/current
sudo docker compose up -d --force-recreate app
echo 'Server configuration updated.'
"@
& ssh -i $KeyPath "$RemoteUser@$Ec2Host" $remoteCommand
if ($LASTEXITCODE -ne 0) { throw "Remote configuration failed. A backup of the previous env file was saved as /etc/zerosum/zerosum.env.bak.* on the server." }

# --- 7. Verify ----------------------------------------------------------------
Write-Host ""
Write-Host "Verifying https://zerosum.website/api/config ..."
$configUrl = if ($Ec2Host -eq "zerosum.website") { "https://zerosum.website/api/config" } else { "http://$Ec2Host/api/config" }
$verified = $false
for ($attempt = 1; $attempt -le 15 -and -not $verified; $attempt++) {
  try {
    $config = Invoke-RestMethod -Uri $configUrl -TimeoutSec 5
    $verified = ($config.googleClientId -eq $GoogleClientId)
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $verified) {
  throw "The server did not advertise the Client ID yet. Check the app logs with: ssh -i `"$KeyPath`" $RemoteUser@$Ec2Host `"cd /opt/zerosum/current && sudo docker compose logs --tail=50 app`""
}

Write-Host ""
Write-Host "DONE - Google sign-in is live on https://zerosum.website" -ForegroundColor Green
Write-Host "Open the site, choose 'Host a tournament' > Sign in, and you should see the Google button under the password form."
Write-Host "If the Google popup says 'origin not allowed', add https://zerosum.website under Authorized JavaScript origins in Google Cloud Console - it can take a few minutes to propagate."