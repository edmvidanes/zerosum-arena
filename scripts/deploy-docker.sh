#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-docker.sh --host EC2_PUBLIC_IP --key /path/to/key.pem [--user ec2-user]
EOF
}

EC2_HOST=""
KEY_PATH=""
REMOTE_USER="ec2-user"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) EC2_HOST="${2:-}"; shift 2 ;;
    --key) KEY_PATH="${2:-}"; shift 2 ;;
    --user) REMOTE_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$EC2_HOST" && -n "$KEY_PATH" ]] || { usage >&2; exit 2; }
[[ -f "$KEY_PATH" ]] || { echo "SSH key not found: $KEY_PATH" >&2; exit 1; }
[[ "$EC2_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid EC2 host." >&2; exit 1; }
[[ "$REMOTE_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || { echo "Invalid remote user." >&2; exit 1; }

for dependency in npm tar scp ssh; do
  command -v "$dependency" >/dev/null || { echo "Missing required command: $dependency" >&2; exit 1; }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="zerosum-$RELEASE_ID.tar.gz"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zerosum-deploy.XXXXXX")"
ARCHIVE_PATH="$TEMP_DIR/$ARCHIVE_NAME"
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$PROJECT_ROOT"
npm ci
npm test
npm run build

tar -czf "$ARCHIVE_PATH" \
  --exclude=node_modules \
  --exclude=app/dist \
  --exclude=.git \
  --exclude='*.pem' \
  --exclude='.env*' \
  .

scp -i "$KEY_PATH" "$ARCHIVE_PATH" "$REMOTE_USER@$EC2_HOST:/tmp/$ARCHIVE_NAME"

REMOTE_DIR="/tmp/zerosum-$RELEASE_ID"
ssh -i "$KEY_PATH" "$REMOTE_USER@$EC2_HOST" \
  "set -e; mkdir -p '$REMOTE_DIR'; tar -xzf '/tmp/$ARCHIVE_NAME' -C '$REMOTE_DIR'; cd '$REMOTE_DIR'; find ops -type f -exec sed -i 's/\r$//' {} +; sudo bash ops/install-docker.sh"

echo "Deployment complete: http://$EC2_HOST"
