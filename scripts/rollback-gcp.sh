#!/bin/bash
#
# Rollback CMS deployment on GCP
#
# Usage: ./scripts/rollback-gcp.sh [version-tag]
#
# This script rolls back the CMS to a previous deployment.
# Stores backups server-side with timestamps for persistent recovery.
#
# Environment variables (optional):
#   GCP_PROJECT   (default: mangoforsalon-97743)
#   GCP_ZONE      (default: us-east1-c)
#   GCP_INSTANCE  (default: mangotemplate-web-server)
#   CMS_HOME      (default: /opt/enrich-cms)

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-mangoforsalon-97743}"
GCP_ZONE="${GCP_ZONE:-us-east1-c}"
GCP_INSTANCE="${GCP_INSTANCE:-mangotemplate-web-server}"
CMS_HOME="${CMS_HOME:-/opt/enrich-cms}"

VERSION_TAG="${1:-}"

if [ -z "$VERSION_TAG" ]; then
  echo "ERROR: Version tag required."
  echo ""
  echo "Usage: $0 <version-tag>"
  echo ""
  echo "Available backups:"
  gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --tunnel-through-iap \
    --strict-host-key-checking=yes \
    --command="ls -lh ${CMS_HOME}/backups/ 2>/dev/null | grep -E '\.tar\.gz' || echo 'No backups found'" || true
  exit 1
fi

echo "=== CMS Rollback ===" 
echo "Instance: $GCP_INSTANCE ($GCP_ZONE)"
echo "Target: $CMS_HOME"
echo "Rollback to: $VERSION_TAG"
echo ""

# Step 1: Stop service
echo "[1/4] Stopping service..."
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="sudo systemctl stop enrich-cms"
echo "✓ Service stopped"

# Step 2: Backup current version
echo "[2/4] Backing up current deployment..."
BACKUP_TAG=$(date +%Y%m%d-%H%M%S)
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="cd ${CMS_HOME} && tar -czf backups/cms-${BACKUP_TAG}.tar.gz out/ data/ && echo 'Current deployment backed up to backups/cms-${BACKUP_TAG}.tar.gz'"
echo "✓ Current deployment backed up"

# Step 3: Restore previous version
echo "[3/4] Restoring backup: $VERSION_TAG..."
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="cd ${CMS_HOME} && tar -xzf backups/${VERSION_TAG}.tar.gz && echo 'Restored ${VERSION_TAG}'"
echo "✓ Restore complete"

# Step 4: Restart service
echo "[4/4] Restarting service..."
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="sudo systemctl start enrich-cms && sleep 2 && sudo systemctl status enrich-cms || true"
echo "✓ Service restarted"

echo ""
echo "=== Rollback Complete ==="
echo "Restored to: $VERSION_TAG"
echo "Previous deployment backed up as: cms-${BACKUP_TAG}.tar.gz"
echo ""
echo "Monitor logs: gcloud compute ssh aisquad@${GCP_INSTANCE} --zone=${GCP_ZONE} --project=${GCP_PROJECT} --tunnel-through-iap --command='journalctl -u enrich-cms -f'"
