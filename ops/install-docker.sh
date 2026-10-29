#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="/opt/zerosum/releases/$RELEASE_ID"

dnf install -y docker sqlite
systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  install -d -m 0755 /usr/local/lib/docker/cli-plugins
  curl --fail --location --silent --show-error \
    https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-linux-x86_64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
fi

# Amazon Linux currently bundles Buildx 0.12, while current Compose requires 0.17+.
# Install our pinned plugin in /usr/local so it takes precedence over the RPM copy.
install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl --fail --location --silent --show-error \
  https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-amd64 \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-buildx
docker buildx version

if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 1G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

test -f /etc/zerosum/zerosum.env || { echo 'Missing /etc/zerosum/zerosum.env' >&2; exit 1; }
install -d -m 0755 /etc/letsencrypt /var/lib/letsencrypt /var/www/certbot
install -d -m 0755 /etc/zerosum/nginx-conf.d
install -d -m 0755 /opt/zerosum/releases
install -d -o 1000 -g 1000 -m 0750 /var/lib/zerosum
install -d -o root -g root -m 0750 /var/backups/zerosum
install -d -m 0755 "$RELEASE_DIR"
cp -a "$SOURCE_DIR/." "$RELEASE_DIR/"
if [[ -f /etc/letsencrypt/live/zerosum.website/fullchain.pem ]]; then
  cp "$RELEASE_DIR/ops/nginx.https.conf" "$RELEASE_DIR/ops/nginx.docker.conf"
fi
ln -sfn "$RELEASE_DIR" /opt/zerosum/current

cd /opt/zerosum/current
if docker ps -aq --filter label=com.docker.compose.project=current | grep -q .; then
  docker compose -p current -f compose.yaml down --remove-orphans
fi
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

install -o root -g root -m 0755 ops/backup-docker.sh /usr/local/sbin/zerosum-backup
install -o root -g root -m 0644 ops/zerosum-backup.service /etc/systemd/system/zerosum-backup.service
install -o root -g root -m 0644 ops/zerosum-backup.timer /etc/systemd/system/zerosum-backup.timer
systemctl daemon-reload
systemctl enable --now zerosum-backup.timer

if [[ -f /etc/letsencrypt/live/zerosum.website/fullchain.pem ]]; then
  install -o root -g root -m 0755 ops/renew-tls.sh /usr/local/sbin/zerosum-renew-tls
  install -o root -g root -m 0644 ops/zerosum-tls-renew.service /etc/systemd/system/zerosum-tls-renew.service
  install -o root -g root -m 0644 ops/zerosum-tls-renew.timer /etc/systemd/system/zerosum-tls-renew.timer
  systemctl daemon-reload
  systemctl enable --now zerosum-tls-renew.timer
fi

for attempt in {1..40}; do
  if curl --fail --silent --location http://127.0.0.1/api/health; then
    echo
    echo "Zerosum $RELEASE_ID deployed successfully."
    exit 0
  fi
  sleep 2
done

docker compose ps
docker compose logs --tail=100
exit 1
