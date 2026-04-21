#!/usr/bin/env bash
# Layer 4 — hourly drift guard.
#
# For every CMS-managed salon, confirm the live URL serves a valid
# /deploy.json (written by the current publish pipeline). Silent on
# success; log to /var/log/cms-drift/drift-YYYY-MM.log on any failure.
#
# This catches drift between CMS state and live URL even when nobody
# hits Publish — stale caches, DNS changes, cert expiry, Firebase ghost
# sites, nginx config wiped, etc.
#
# Runs hourly via /etc/systemd/system/cms-drift-check.timer.

set -u

SITES_ROOT="/opt/enrich-cms/sites"
LOG_DIR="/var/log/cms-drift"
LOG_FILE="${LOG_DIR}/drift-$(date -u +%Y-%m).log"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR"
: > /tmp/cms-drift-run.$$.tmp

total=0
ok=0
fail=0

for cfg in "$SITES_ROOT"/*/config/salon.json; do
  [ -f "$cfg" ] || continue
  slug=$(basename "$(dirname "$(dirname "$cfg")")")
  total=$((total+1))

  site_status=$(jq -r '.siteStatus // "staging"' "$cfg" 2>/dev/null)
  if [ "$site_status" = "production" ]; then
    host=$(jq -r '.domain // ""' "$cfg" 2>/dev/null)
    target="prod"
  else
    host=$(jq -r '.stagingDomain // ""' "$cfg" 2>/dev/null)
    target="staging"
  fi

  # Normalize to lowercase (defence-in-depth; Layer 1 already stores lowercase).
  host=$(echo "$host" | tr '[:upper:]' '[:lower:]')

  if [ -z "$host" ] || [ "$host" = "null" ]; then
    # No host configured — skip, not drift.
    continue
  fi

  url="https://${host}/deploy.json?_v=$(date +%s)"
  resp=$(curl -sSk --max-time 8 -w '\n__HTTP__%{http_code}' "$url" 2>&1)
  code=$(echo "$resp" | awk -F '__HTTP__' '/__HTTP__/{print $2}' | head -1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" = "200" ]; then
    live_hash=$(echo "$body" | jq -r '.hash // ""' 2>/dev/null)
    if [ -n "$live_hash" ] && [ "$live_hash" != "null" ]; then
      ok=$((ok+1))
      continue
    fi
    # 200 but no hash = deploy.json was served but lacks the hash field.
    echo "${TS}  ${slug}  ${target}  ${host}  deploy_json_missing_hash  (200 OK, body=${body:0:120})" >> /tmp/cms-drift-run.$$.tmp
    fail=$((fail+1))
    continue
  fi

  # Non-200 — classify.
  if [ "$code" = "404" ]; then
    reason="deploy_json_404"
  elif [ -z "$code" ]; then
    reason="fetch_failed"
  else
    reason="http_${code}"
  fi
  echo "${TS}  ${slug}  ${target}  ${host}  ${reason}" >> /tmp/cms-drift-run.$$.tmp
  fail=$((fail+1))
done

# Append drift entries to monthly log
if [ -s /tmp/cms-drift-run.$$.tmp ]; then
  echo "# --- run ${TS}  total=${total}  ok=${ok}  drifted=${fail} ---" >> "$LOG_FILE"
  cat /tmp/cms-drift-run.$$.tmp >> "$LOG_FILE"
fi

# Always emit a one-line summary to stderr (captured by journald when run
# under systemd, visible in journalctl -u cms-drift-check.service).
>&2 echo "[cms-drift-check] ${TS}  total=${total}  ok=${ok}  drifted=${fail}"

rm -f /tmp/cms-drift-run.$$.tmp

# Exit non-zero if any drift, so systemd shows a failure badge — easy to
# spot via `systemctl list-timers` + `systemctl status cms-drift-check`.
[ "$fail" -eq 0 ] && exit 0 || exit 1
