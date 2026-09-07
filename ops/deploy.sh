#!/usr/bin/env bash
#
# Deploy the Quill chat server on the urbancare VM (46.62.171.19).
#
#   ops/deploy.sh prod   ->  ~/quill      :8086  unit quill      (DB quill)
#   ops/deploy.sh dev    ->  ~/quill-dev  :8087  unit quill-dev  (DB quill-dev)
#
# Run it FROM the checkout you are deploying, after that checkout has been
# synced to the branch you want; CI does the fetch/reset.
#
# Restarting Quill drops every live Socket.IO session — clients reconnect, but
# in-flight sends can fail. The dev target is inert until quill-dev.service is
# installed (see ops/README.md).
set -euo pipefail

TARGET=${1:-prod}
case "$TARGET" in
  prod) UNIT=quill;     HEALTH=http://127.0.0.1:8086/swagger ;;
  dev)  UNIT=quill-dev; HEALTH=http://127.0.0.1:8087/swagger ;;
  *)    echo "usage: $0 [prod|dev]" >&2; exit 2 ;;
esac

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

cd "$REPO_DIR"
log "deploying $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s)) -> $UNIT"

log "installing dependencies"
choom -n 900 -- npm ci --no-audit --no-fund

rm -rf dist.rollback
[ -d dist ] && cp -r dist dist.rollback && log "kept the running build as dist.rollback"

log "building"
choom -n 900 -- npm run build

log "restarting $UNIT"
sudo -n /usr/bin/systemctl restart "$UNIT"

waited=0
while [ "$waited" -lt 90 ]; do
  sleep 5
  waited=$((waited + 5))
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH" || true)" = 200 ]; then
    log "healthy after ${waited}s - deploy OK"
    exit 0
  fi
done

log "HEALTH CHECK FAILED after ${waited}s - rolling back"
if [ -d dist.rollback ]; then
  rm -rf dist
  mv dist.rollback dist
  sudo -n /usr/bin/systemctl restart "$UNIT"
  log "previous build restored, $UNIT restarted - CHECK $HEALTH"
else
  log "no rollback build available - $UNIT may be down"
fi
exit 1
