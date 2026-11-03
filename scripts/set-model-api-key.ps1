# ZeroSum Arena - install the Meta Model API key on EC2.
# Run this YOURSELF: typing is hidden, the key goes only over SSH to your server.
#   .\scripts\set-model-api-key.ps1
param([string]$Ec2Host = "54.79.58.86", [string]$KeyPath = "C:\Dale\Project\Hackathon-Meta\ZeroSumProd.pem")
$ErrorActionPreference = "Stop"
Write-Host "Get a free key at https://dev.meta.ai (Dashboard -> Create API key, starts with LLM_)"
$secure = Read-Host "Paste MODEL_API_KEY (hidden)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $plain.StartsWith("LLM_")) { Write-Host "Not a Meta key (expected LLM_ prefix). Nothing changed." -ForegroundColor Red; exit 1 }
$remote = 'read -r KEY; sudo grep -v "^MODEL_API_KEY=" /etc/zerosum/zerosum.env > /tmp/zs.env || true; printf "MODEL_API_KEY=%s\n" "$KEY" >> /tmp/zs.env; sudo install -m 600 -o root -g root /tmp/zs.env /etc/zerosum/zerosum.env; rm -f /tmp/zs.env; cd /opt/zerosum/current && sudo docker compose up -d --force-recreate app >/dev/null; sleep 8; curl -s http://127.0.0.1/api/config; echo'
try { $plain | ssh -i $KeyPath -o StrictHostKeyChecking=no "ec2-user@$Ec2Host" $remote; Write-Host "Done - look for aiEnabled:true above, then sign in as admin and open AI Pack Forge." -ForegroundColor Green } finally { $plain = $null }
