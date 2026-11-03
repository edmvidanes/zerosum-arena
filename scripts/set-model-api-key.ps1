# ZeroSum Arena - securely install the Meta Model API key on EC2.
# Run it yourself; typing is hidden and the key is base64-wrapped only to survive SSH quoting intact.
#   .\scripts\set-model-api-key.ps1
param([string]$Ec2Host = "zerosum.website", [string]$KeyPath = "$HOME\.ssh\zerosum.pem")
$ErrorActionPreference = "Stop"
Write-Host "Get a key at https://dev.meta.ai (Dashboard -> Create API key, starts with LLM_)"
$secure = Read-Host "Paste MODEL_API_KEY (hidden)" -AsSecureString
$plain = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))).Trim()
if (-not $plain.StartsWith("LLM_")) { Write-Host "Not a Meta key (expected LLM_ prefix). Nothing changed." -ForegroundColor Red; exit 1 }
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))
$plain = $null
$remote = 'K=$(echo __B64__ | base64 -d); sudo grep -v "^MODEL_API_KEY=" /etc/zerosum/zerosum.env > /tmp/zs.env || true; printf "MODEL_API_KEY=%s\n" "$K" >> /tmp/zs.env; sudo install -m 600 -o root -g root /tmp/zs.env /etc/zerosum/zerosum.env; rm -f /tmp/zs.env; cd /opt/zerosum/current && sudo docker compose up -d --force-recreate app > /dev/null; sleep 8; echo CONFIG:; curl -s http://127.0.0.1/api/config; echo; K2=$(sudo grep "^MODEL_API_KEY=" /etc/zerosum/zerosum.env | cut -d= -f2-); echo -n "META KEY TEST HTTP: "; curl -s -o /dev/null -w "%{http_code}\n" https://api.meta.ai/v1/models -H "Authorization: Bearer $K2"'
$remote = $remote.Replace('__B64__', $b64)
ssh -i $KeyPath -o StrictHostKeyChecking=no "ec2-user@$Ec2Host" $remote
Write-Host "If META KEY TEST HTTP is 200 and aiEnabled:true, sign in as admin and open AI Pack Forge. If it is 401, create a fresh key at dev.meta.ai and run this again." -ForegroundColor Green
