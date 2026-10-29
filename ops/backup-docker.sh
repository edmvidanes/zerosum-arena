#!/usr/bin/env bash
set -euo pipefail

DATABASE=/var/lib/zerosum/zerosum.sqlite
BACKUP_DIR=/var/backups/zerosum
test -f "$DATABASE" || exit 0
install -d -m 0750 "$BACKUP_DIR"
sqlite3 "$DATABASE" ".backup '$BACKUP_DIR/zerosum-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
find "$BACKUP_DIR" -type f -name 'zerosum-*.sqlite' -mtime +14 -delete
