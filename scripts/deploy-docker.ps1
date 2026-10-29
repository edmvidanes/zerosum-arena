[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Ec2Host,
  [Parameter(Mandatory = $true)][string]$KeyPath,
  [string]$RemoteUser = "ec2-user"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseId = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$archiveName = "zerosum-$releaseId.tar.gz"
$archivePath = Join-Path $env:TEMP $archiveName

Push-Location -LiteralPath $projectRoot
try {
  npm ci
  npm test
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build or tests failed." }
  tar -czf $archivePath --exclude=node_modules --exclude=app/dist --exclude=.git --exclude='*.pem' --exclude='.env*' .
  if ($LASTEXITCODE -ne 0) { throw "Packaging failed." }
  & scp -i $KeyPath $archivePath "${RemoteUser}@${Ec2Host}:/tmp/$archiveName"
  if ($LASTEXITCODE -ne 0) { throw "Upload failed." }
  $remoteDir = "/tmp/zerosum-$releaseId"
  $remoteCommand = "set -e; mkdir -p '$remoteDir'; tar -xzf '/tmp/$archiveName' -C '$remoteDir'; cd '$remoteDir'; find ops -type f -exec sed -i 's/\r$//' {} +; sudo bash ops/install-docker.sh"
  & ssh -i $KeyPath "${RemoteUser}@${Ec2Host}" $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "Remote installation failed." }
  Write-Host "Deployment complete: http://$Ec2Host"
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
}
