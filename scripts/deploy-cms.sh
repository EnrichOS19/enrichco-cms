#!/bin/bash
# deploy-cms.sh — canonical CMS deploy script
# Every production deploy MUST go through this script. No exceptions.
#
# Usage: ./scripts/deploy-cms.sh
#
# Environment (optional overrides):
#   GCP_PROJECT   default: mangoforsalon-97743
#   GCP_ZONE      default: us-east1-c
#   GCP_INSTANCE  default: mangotemplate-web-server
#   DEPLOY_DIR    default: /opt/enrich-cms/out/standalone
#   CMS_SERVICE   default: enrich-cms

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-mangoforsalon-97743}"
GCP_ZONE="${GCP_ZONE:-us-east1-c}"
GCP_INSTANCE="${GCP_INSTANCE:-mangotemplate-web-server}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/enrich-cms/out/standalone}"
CMS_SERVICE="${CMS_SERVICE:-enrich-cms}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }

remote() {
  gcloud compute ssh "aisquad@${GCP_INSTANCE}" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --tunnel-through-iap \
    --strict-host-key-checking=yes \
    --command="$1"
}

# ── step 1: build ─────────────────────────────────────────────────────────────
log "=== CMS Deploy — $(date) ==="
log "[1/7] Building locally…"
cd "$REPO_ROOT"
npm run build || fail "npm run build failed"
log "Build OK"

# ── step 2: verify artifact completeness ──────────────────────────────────────
log "[2/7] Verifying build artifacts…"
[[ -d ".next/standalone" ]]  || fail "Missing .next/standalone/ — Next.js output-mode must be 'standalone'"
[[ -d ".next/static" ]]      || fail "Missing .next/static/ — CSS/JS chunks absent"
[[ -f ".next/BUILD_ID" ]]    || fail "Missing .next/BUILD_ID"
BUILD_ID="$(cat .next/BUILD_ID)"
log "BUILD_ID: $BUILD_ID"
log "Artifact check OK"

# ── step 3: create tar (no macOS junk) ────────────────────────────────────────
log "[3/7] Packaging artifact…"
TS="$(date +%s)"
TAR_FILE="/tmp/cms-deploy-${TS}.tar.gz"

TAR_ARGS=(
  --exclude='._*'
  --exclude='.DS_Store'
  --exclude='*.node'       # rebuild on server — avoid mac ARM binaries
  -czf "$TAR_FILE"
  .next/standalone/
  .next/static/
)
[[ -d "public" ]] && TAR_ARGS+=(public/)
TAR_ARGS+=(package.json)

tar "${TAR_ARGS[@]}" || fail "tar failed"
log "Artifact: $TAR_FILE ($(du -sh "$TAR_FILE" | cut -f1))"

# ── step 4: upload (retry once on failure) ────────────────────────────────────
log "[4/7] Uploading to server via IAP…"
REMOTE_TAR="/tmp/cms-deploy-${TS}.tar.gz"
upload_once() {
  gcloud compute scp "$TAR_FILE" \
    "aisquad@${GCP_INSTANCE}:${REMOTE_TAR}" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --tunnel-through-iap \
    --strict-host-key-checking=yes
}

if ! upload_once; then
  log "Upload failed, retrying once…"
  sleep 5
  upload_once || fail "Upload failed after retry"
fi
log "Upload OK"

# ── step 5: install on server ─────────────────────────────────────────────────
log "[5/7] Installing on server…"

# Build the remote install script as a heredoc and pipe it in one SSH call
# to avoid quoting hell and multiple round-trips.
INSTALL_SCRIPT=$(cat <<REMOTE_SCRIPT
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR}"
REMOTE_TAR="${REMOTE_TAR}"
TS="${TS}"
CMS_SERVICE="${CMS_SERVICE}"

echo "--- backup current deployment ---"
if [ -d "\$DEPLOY_DIR" ]; then
  BACKUP="\${DEPLOY_DIR}.old.\${TS}"
  mv "\$DEPLOY_DIR" "\$BACKUP"
  echo "Backed up to \$BACKUP"
fi

echo "--- extract new build ---"
mkdir -p "\$DEPLOY_DIR"
cd "\$(dirname "\$DEPLOY_DIR")"   # /opt/enrich-cms/out

# Clean up stale root-level siblings before extraction so no prior-deploy
# artefacts survive into the new build.
rm -rf "\$(dirname "\$DEPLOY_DIR")/static" "\$(dirname "\$DEPLOY_DIR")/public"
rm -f  "\$(dirname "\$DEPLOY_DIR")/package.json"

# Extract top-level dirs from the tar into place:
# standalone/ is the Next.js standalone server
# static/     is the _next/static asset tree
# The .next/* entries have a leading .next/ component; strip it so they land at cwd.
tar --exclude='._*' --strip-components=1 -xzf "\$REMOTE_TAR" .next/standalone .next/static

# Extract package.json (REQUIRED — hard-fail if missing or tar error).
tar --exclude='._*' -xzf "\$REMOTE_TAR" package.json \
  || { echo "FATAL: failed to extract package.json from tar"; exit 1; }

# Extract public/ (OPTIONAL — probe first; if present, hard-fail on error).
if tar -tzf "\$REMOTE_TAR" public/ >/dev/null 2>&1; then
  tar --exclude='._*' -xzf "\$REMOTE_TAR" public/ \
    || { echo "FATAL: public/ is present in tar but extraction failed"; exit 1; }
fi

# Merge static and public into standalone so the server can serve them
echo "--- copy .next/static into standalone ---"
# standalone/.next/static must exist — this is the step that was missed
mkdir -p "\$DEPLOY_DIR/.next/static"
if [ -d "\$(dirname "\$DEPLOY_DIR")/static" ]; then
  cp -r "\$(dirname "\$DEPLOY_DIR")/static/." "\$DEPLOY_DIR/.next/static/"
  echo ".next/static copied into standalone"
else
  echo "FATAL: .next/static not found at extract root — required artifact missing, aborting deploy"; exit 1
fi

# Copy public/ into standalone/public/ if present at extract root
if [ -d "\$(dirname "\$DEPLOY_DIR")/public" ]; then
  mkdir -p "\$DEPLOY_DIR/public"
  cp -r "\$(dirname "\$DEPLOY_DIR")/public/." "\$DEPLOY_DIR/public/"
  echo "public/ copied into standalone"
fi

# Copy package.json into standalone/ (extracted to out/ by the no-strip pass above)
if [ -f "\$(dirname "\$DEPLOY_DIR")/package.json" ]; then
  cp "\$(dirname "\$DEPLOY_DIR")/package.json" "\$DEPLOY_DIR/package.json"
  echo "package.json copied into standalone"
fi

echo "--- rebuild native modules for Linux ---"
cd "\$DEPLOY_DIR"
npm rebuild better-sqlite3 || { echo "FATAL: npm rebuild better-sqlite3 failed — aborting deploy"; exit 1; }

echo "--- verify better_sqlite3.node is Linux ELF64 ---"
NODE_BIN="\$(find "\$DEPLOY_DIR/node_modules" -name better_sqlite3.node 2>/dev/null | head -1)"
if [ -n "\$NODE_BIN" ]; then
  file "\$NODE_BIN" | grep -q 'ELF 64-bit LSB.*x86-64' \
    || { echo "FATAL: better_sqlite3.node is NOT Linux x86-64 ELF — wrong platform binary"; exit 1; }
  echo "better_sqlite3.node: Linux x86-64 ELF OK"
else
  echo "WARN: better_sqlite3.node not found — skipping platform check"
fi

echo "--- restart service ---"
sudo systemctl restart "\$CMS_SERVICE"
sleep 5
sudo systemctl is-active "\$CMS_SERVICE" || { echo "FATAL: service failed to start"; sudo journalctl -u "\$CMS_SERVICE" -n 50 --no-pager; exit 1; }

echo "--- check logs for errors ---"
ERRS=\$(sudo journalctl -u "\$CMS_SERVICE" --since '15 sec ago' --no-pager 2>/dev/null \
  | grep -iE 'error|fail' || true)
if [ -n "\$ERRS" ]; then
  echo "ERROR: journal contains errors after restart:"
  echo "\$ERRS"
  exit 1
fi

echo "--- clean up remote tarball ---"
rm -f "\$REMOTE_TAR"

echo "INSTALL_OK build_id=${BUILD_ID}"
REMOTE_SCRIPT
)

RESULT="$(remote "bash -s" <<< "$INSTALL_SCRIPT")" || {
  log "Server install failed. Output:"
  echo "$RESULT"
  log "Attempting to restore backup after install failure…"
  RESTORE_SCRIPT=$(cat <<RESTORE_SCRIPT_EOF
set -euo pipefail
DEPLOY_DIR="${DEPLOY_DIR}"
CMS_SERVICE="${CMS_SERVICE}"
TS="${TS}"

BACKUP="\${DEPLOY_DIR}.old.\${TS}"
if [ -d "\$BACKUP" ]; then
  echo "Restoring backup \$BACKUP after failed install"
  rm -rf "\$DEPLOY_DIR"
  rm -rf "\$(dirname "\$DEPLOY_DIR")/static" "\$(dirname "\$DEPLOY_DIR")/public"
  rm -f  "\$(dirname "\$DEPLOY_DIR")/package.json"
  mv "\$BACKUP" "\$DEPLOY_DIR"
  sudo systemctl restart "\$CMS_SERVICE"
  sleep 5
  sudo systemctl is-active "\$CMS_SERVICE" && echo "RESTORE_OK" || echo "RESTORE_SERVICE_FAIL"
else
  echo "RESTORE_SKIP: no backup at \$BACKUP (failure occurred before backup step)"
fi
RESTORE_SCRIPT_EOF
  )
  RS_RESULT="$(remote "bash -s" <<< "$RESTORE_SCRIPT")" || true
  echo "$RS_RESULT"
  fail "Remote install failed"
}

echo "$RESULT"
echo "$RESULT" | grep -q "INSTALL_OK" || fail "Install did not complete successfully"
log "Server install OK"

# ── step 6: smoke test + auto-rollback ────────────────────────────────────────
log "[6/7] Running smoke test…"
SMOKE_EXIT=0
"$SCRIPT_DIR/smoke-cms.sh" || SMOKE_EXIT=$?

if [[ $SMOKE_EXIT -ne 0 ]]; then
  log "SMOKE FAILED — initiating auto-rollback…"
  ROLLBACK_SCRIPT=$(cat <<ROLLBACK
set -euo pipefail
DEPLOY_DIR="${DEPLOY_DIR}"
CMS_SERVICE="${CMS_SERVICE}"
TS="${TS}"

BACKUP="\${DEPLOY_DIR}.old.\${TS}"
if [ -d "\$BACKUP" ]; then
  echo "Rolling back to \$BACKUP"
  rm -rf "\$DEPLOY_DIR"
  # Remove any root-level siblings the failed deploy extracted so the next
  # deploy starts from a clean slate.
  rm -rf "\$(dirname "\$DEPLOY_DIR")/static" "\$(dirname "\$DEPLOY_DIR")/public"
  rm -f  "\$(dirname "\$DEPLOY_DIR")/package.json"
  mv "\$BACKUP" "\$DEPLOY_DIR"
  sudo systemctl restart "\$CMS_SERVICE"
  sleep 5
  sudo systemctl is-active "\$CMS_SERVICE" && echo "ROLLBACK_OK" || echo "ROLLBACK_SERVICE_FAIL"
else
  echo "ROLLBACK_NO_BACKUP: backup not found at \$BACKUP"
  exit 1
fi
ROLLBACK
)
  RB_RESULT="$(remote "bash -s" <<< "$ROLLBACK_SCRIPT")" || true
  echo "$RB_RESULT"
  log "Rollback complete. Deploy failed — fix the issue and retry."
  fail "Smoke test failed — auto-rollback executed (see above for details)"
fi

log "Smoke test PASSED"

# ── step 7: report ────────────────────────────────────────────────────────────
DEPLOY_TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
log "[7/7] Deploy complete"
echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  CMS Deploy Successful                                  │"
echo "│                                                         │"
printf "│  BUILD_ID:  %-43s │\n" "$BUILD_ID"
printf "│  Deployed:  %-43s │\n" "$DEPLOY_TS"
printf "│  Target:    %-43s │\n" "$GCP_INSTANCE:$DEPLOY_DIR"
echo "│  Smoke:     PASSED                                      │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""
echo "Rollback if needed: gcloud compute ssh aisquad@${GCP_INSTANCE} --zone=${GCP_ZONE} --project=${GCP_PROJECT} --tunnel-through-iap --command='ls ${DEPLOY_DIR}.old.*'"
