#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$SCRIPT_DIR/.deploy.conf"

if [[ ! -f "$CONF" ]]; then
  echo "No .deploy.conf found — let's create one."
  read -rp "SYNOLOGY_HOST (e.g. 192.168.1.100 or nas.local): " host
  read -rp "SYNOLOGY_USER [user]: " user
  user="${user:-user}"
  read -rp "SYNOLOGY_DIR [/volume1/docker/ics]: " dir
  dir="${dir:-/volume1/docker/ics}"

  cat > "$CONF" <<EOF
SYNOLOGY_HOST=$host
SYNOLOGY_USER=$user
SYNOLOGY_DIR=$dir
EOF
  echo "Wrote $CONF"
fi

# shellcheck source=/dev/null
source "$CONF"

REMOTE="${SYNOLOGY_USER}@${SYNOLOGY_HOST}"
SSH_SOCK="/tmp/deploy-ics-$$"
SSH_OPTS="-o BatchMode=yes -o ControlMaster=auto -o ControlPath=${SSH_SOCK} -o ControlPersist=60"

cleanup() { ssh -o ControlPath="${SSH_SOCK}" -O exit "$REMOTE" 2>/dev/null || true; }
trap cleanup EXIT

# Open a shared SSH connection (authenticates once, reused by all subsequent calls)
echo "==> Connecting to ${REMOTE}..."
ssh $SSH_OPTS "$REMOTE" "mkdir -p ${SYNOLOGY_DIR}"

# macOS ships openrsync (protocol 29) which is incompatible with Synology's rsync 3.x.
# Use tar over SSH instead — universally compatible and handles excludes fine.
echo "==> Syncing project to ${REMOTE}:${SYNOLOGY_DIR}..."
tar cf - --no-mac-metadata \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=plans \
  --exclude=.claude \
  --exclude=.deploy.conf \
  . | ssh $SSH_OPTS "$REMOTE" "cd ${SYNOLOGY_DIR} && rm -rf ./* && tar xf -"

echo "==> Building and starting container on Synology..."
ssh $SSH_OPTS "$REMOTE" "export PATH=/usr/local/bin:\$PATH && cd ${SYNOLOGY_DIR} && sudo docker compose up -d --build"

echo "==> Done. Tailing logs (Ctrl-C to stop)..."
ssh $SSH_OPTS "$REMOTE" "export PATH=/usr/local/bin:\$PATH && cd ${SYNOLOGY_DIR} && sudo docker compose logs -f --tail=40"
