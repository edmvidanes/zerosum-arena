#!/usr/bin/env bash
set -euo pipefail

DOMAIN="zerosum.website"
EMAIL="${1:-}"
PROJECT_DIR="/opt/zerosum/current"

if [[ -z "$EMAIL" || "$EMAIL" != *@* ]]; then
  echo "Usage: sudo bash ops/enable-https.sh YOUR_EMAIL" >&2
  exit 2
fi

cd "$PROJECT_DIR"
install -d -m 0755 /etc/letsencrypt /var/lib/letsencrypt /var/www/certbot

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot:latest certonly \
  --webroot --webroot-path /var/www/certbot \
  --non-interactive --agree-tos --email "$EMAIL" \
  --cert-name "$DOMAIN" \
  -d "$DOMAIN" -d "www.$DOMAIN"

cp ops/nginx.docker.conf ops/nginx.http.conf
cp ops/nginx.https.conf ops/nginx.docker.conf

if ! docker compose run --rm --no-deps nginx nginx -t; then
  cp ops/nginx.http.conf ops/nginx.docker.conf
  echo "HTTPS configuration failed validation; HTTP configuration restored." >&2
  exit 1
fi

docker compose up -d nginx
docker compose exec -T nginx nginx -s reload
install -o root -g root -m 0755 ops/renew-tls.sh /usr/local/sbin/zerosum-renew-tls
install -o root -g root -m 0644 ops/zerosum-tls-renew.service /etc/systemd/system/zerosum-tls-renew.service
install -o root -g root -m 0644 ops/zerosum-tls-renew.timer /etc/systemd/system/zerosum-tls-renew.timer
systemctl daemon-reload
systemctl enable --now zerosum-tls-renew.timer

curl --fail --show-error --silent "https://$DOMAIN/api/health"
echo
echo "HTTPS enabled at https://$DOMAIN"
