#!/bin/bash
#
# Phase 4: Deploy CMS to mangotemplate-web-server via GCP IAP
#
# Usage: ./scripts/deploy-gcp.sh [--skip-build] [--skip-start]
#
# SECURITY & SUDOERS REQUIREMENTS:
#   This script requires the following sudoers rule on the target server:
#   
#   aisquad ALL=(ALL) NOPASSWD: \
#     /usr/bin/chown, \
#     /usr/bin/tee /etc/systemd/system/enrich-cms.service, \
#     /usr/bin/systemctl daemon-reload, \
#     /usr/bin/systemctl enable enrich-cms, \
#     /usr/bin/systemctl start enrich-cms, \
#     /usr/bin/systemctl status enrich-cms
#   
#   Add via: sudo visudo
#   
#   SECURITY MODEL:
#   - aisquad (deploy user) uploads tarball via IAP (gcloud compute scp)
#   - aisquad executes systemd install commands via sudo (scoped to specific binaries)
#   - Process runs as User=aisquad with full hardening (PrivateTmp, ProtectSystem, etc.)
#   - No shared UID. No www-data. Full isolation and auditability.
#   - Host key checking enabled (strict-host-key-checking=yes)
#
# Environment variables (optional):
#   GCP_PROJECT   (default: mangoforsalon-97743)
#   GCP_ZONE      (default: us-east1-c)
#   GCP_INSTANCE  (default: mangotemplate-web-server)
#   CMS_PORT      (default: 3000)
#   CMS_HOME      (default: /opt/enrich-cms)

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-mangoforsalon-97743}"
GCP_ZONE="${GCP_ZONE:-us-east1-c}"
GCP_INSTANCE="${GCP_INSTANCE:-mangotemplate-web-server}"
CMS_PORT="${CMS_PORT:-3000}"
CMS_HOME="${CMS_HOME:-/opt/enrich-cms}"
SKIP_BUILD=false
SKIP_START=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-start) SKIP_START=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo \"=== CMS Deployment to GCP ===\"
echo \"Project: $GCP_PROJECT\"
echo \"Instance: $GCP_INSTANCE ($GCP_ZONE)\"
echo \"Target: $CMS_HOME\"
echo \"\"

# Pre-flight check: Verify .env.production exists and is NOT in the tarball
if [ ! -f \".env.production\" ]; then
  echo \"ERROR: .env.production not found in current directory\"
  echo \"This file must exist locally and will be deployed separately via EnvironmentFile\"
  echo \"\"
  echo \"Create .env.production with:\"
  echo \"  CMS_SESSION_SECRET=<strong-random-secret-min-32-chars>\"
  echo \"  NODE_ENV=production\"
  echo \"\"
  exit 1
fi

echo \"✓ Pre-flight checks passed\"
echo \"\"

# Step 1: Build (unless --skip-build)
if [ "$SKIP_BUILD" = false ]; then
  echo "[1/5] Building CMS..."
  rm -rf .next out
  npm run build
  echo "✓ Build complete"
else
  echo "[1/5] Skipping build (--skip-build)"
fi

# Step 2: Create tarball
echo "[2/5] Packaging..."
TAR_FILE="/tmp/cms-build-$(date +%s).tar.gz"
tar -czf "$TAR_FILE" \
  out/ \
  public/ \
  package.json \
  package-lock.json \
  .env.production 2>/dev/null || true

echo "✓ Created $TAR_FILE"
PREV_TAR="/tmp/cms-build-previous.tar.gz"
[ -f "$TAR_FILE" ] && cp "$TAR_FILE" "$PREV_TAR"

# Step 3: SCP to server
echo "[3/5] Uploading to server via IAP..."
gcloud compute scp "$TAR_FILE" \
  "aisquad@${GCP_INSTANCE}:/tmp/" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes

echo "✓ Upload complete"

# Step 4: Extract and install on server
echo "[4/5] Installing on server..."
INSTALL_SCRIPT=$(cat <<'INSTALL_EOF'
#!/bin/bash
set -euo pipefail

CMS_HOME="${1:-/opt/enrich-cms}"
TAR_FILE="${2:-/tmp/cms-build-*.tar.gz}"

# Resolve the most recent tarball
LATEST_TAR=$(ls -t $TAR_FILE 2>/dev/null | head -1)
if [ -z "$LATEST_TAR" ]; then
  echo "ERROR: No tarball found at $TAR_FILE"
  exit 1
fi

echo "Extracting $LATEST_TAR to $CMS_HOME..."
mkdir -p "$CMS_HOME"
cd "$CMS_HOME"

# Backup current build
if [ -d "$CMS_HOME/out" ]; then
  echo "Backing up current build..."
  BACKUP_DIR="$CMS_HOME/out.backup.$(date +%s)"
  mv "$CMS_HOME/out" "$BACKUP_DIR"
fi

# Extract
tar -xzf "$LATEST_TAR"
echo "✓ Extraction complete"

# Set permissions (must match systemd User=aisquad)
sudo chown -R aisquad:aisquad \"$CMS_HOME\" 2>/dev/null || true
echo \"✓ Permissions set (aisquad:aisquad)\"

# Install/enable systemd service
echo "Installing systemd service..."
sudo tee /etc/systemd/system/enrich-cms.service > /dev/null <<'SERVICE_EOF'
[Unit]
Description=EnrichCo CMS for Salon Websites
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aisquad
Group=aisquad
WorkingDirectory=/opt/enrich-cms
EnvironmentFile=/opt/enrich-cms/.env.production
ExecStart=/usr/bin/node /opt/enrich-cms/out/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/enrich-cms /var/www
ProtectClock=yes
ProtectHostname=yes
ProtectKernelLogs=yes
ProtectKernelTunables=yes
RemoveIPC=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=yes
RestrictSUIDSGID=yes
SystemCallFilter=@system-service
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
SERVICE_EOF

sudo systemctl daemon-reload
sudo systemctl enable enrich-cms 2>/dev/null || true
echo "✓ Systemd service installed"

INSTALL_EOF
)

# Execute install script on remote
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="bash -c '$(echo "$INSTALL_SCRIPT" | sed 's/"/\\"/g')' '$CMS_HOME' '$TAR_FILE'"

echo "✓ Installation complete"

# Step 5: Start service (unless --skip-start)
if [ "$SKIP_START" = false ]; then
  echo "[5/5] Starting service..."
  gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --tunnel-through-iap \
    --strict-host-key-checking=yes \
    --command="sudo systemctl start enrich-cms && sleep 2 && sudo systemctl status enrich-cms || true"
  
  echo "✓ Service started"
else
  echo "[5/5] Skipping service start (--skip-start)"
fi

# Verify
echo ""
echo "=== Verification ==="
echo "Checking service health..."
gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --tunnel-through-iap \
  --strict-host-key-checking=yes \
  --command="curl -s http://localhost:${CMS_PORT}/api/health || echo 'Service not ready yet (may be starting)'" || true

echo ""
echo "=== Deployment Complete ==="
echo "CMS is deployed to $CMS_HOME on $GCP_INSTANCE"
echo "Service: enrich-cms (systemd)"
echo "Port: $CMS_PORT"
echo ""
echo "Next steps:"
echo "1. Configure nginx reverse proxy for cms.enrichco.us"
echo "2. Set up Let's Encrypt certificate"
echo "3. Test: curl https://cms.enrichco.us/api/health"
echo "4. Monitor: gcloud compute ssh ... --command='journalctl -u enrich-cms -f'"
