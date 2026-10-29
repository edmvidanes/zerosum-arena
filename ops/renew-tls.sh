#!/usr/bin/env bash
set -euo pipefail

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot:latest renew \
  --webroot --webroot-path /var/www/certbot \
  --no-random-sleep-on-renew --quiet

cd /opt/zerosum/current
docker compose exec -T nginx nginx -s reload
