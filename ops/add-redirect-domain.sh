#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
DESTINATION="${2:-}"
EMAIL="${3:-}"
PROJECT_DIR="/opt/zerosum/current"

if [[ ! "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
  echo "Usage: sudo bash ops/add-redirect-domain.sh DOMAIN https://DESTINATION/ EMAIL" >&2
  exit 2
fi
if [[ ! "$DESTINATION" =~ ^https://[A-Za-z0-9.-]+/$ ]]; then
  echo "Destination must be an HTTPS origin ending in /." >&2
  exit 2
fi
if [[ "$EMAIL" != *@* ]]; then
  echo "A valid certificate-notification email is required." >&2
  exit 2
fi

cd "$PROJECT_DIR"
install -d -m 0755 /etc/letsencrypt /var/lib/letsencrypt /var/www/certbot /etc/zerosum/nginx-conf.d

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot:latest certonly \
  --webroot --webroot-path /var/www/certbot \
  --non-interactive --agree-tos --email "$EMAIL" \
  --cert-name "$DOMAIN" \
  -d "$DOMAIN" -d "www.$DOMAIN"

CONFIG_PATH="/etc/zerosum/nginx-conf.d/$DOMAIN.conf"
TEMP_CONFIG="$(mktemp)"
trap 'rm -f "$TEMP_CONFIG"' EXIT

cat >"$TEMP_CONFIG" <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 302 $DESTINATION;
    }
}

server {
    listen 443 ssl;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    add_header Strict-Transport-Security "max-age=86400" always;

    return 302 $DESTINATION;
}
EOF

install -o root -g root -m 0644 "$TEMP_CONFIG" "$CONFIG_PATH"
if ! docker compose run --rm --no-deps nginx nginx -t; then
  rm -f "$CONFIG_PATH"
  echo "Redirect configuration failed validation and was removed." >&2
  exit 1
fi
docker compose up -d --force-recreate --no-deps nginx
docker compose exec -T nginx nginx -t

curl --fail --show-error --silent --head "https://$DOMAIN/" | grep -q "302"
echo "Temporary redirect enabled: https://$DOMAIN -> $DESTINATION"
