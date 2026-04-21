#!/usr/bin/env bash
# Layer 4 — hourly drift guard.
#
# For every CMS-managed salon, confirm the live URL serves a /deploy.json
# whose hash MATCHES the most recent successful publish recorded for that
# salon. Catches drift between CMS state and live URL even when nobody
# clicks Publish — stale caches, DNS changes, cert expiry, Firebase ghost
# sites, nginx config wiped, an unrelated service writing to /var/www, etc.
#
# Expected hashes are maintained at /var/log/cms-drift/expected-hashes.tsv
# (format: `slug\thash\tdomain\ttimestamp`). buildAndDeploy() appends a row
# immediately after the atomic public/ swap completes (before the publish
# route's verifyLiveDeploy() runs). If verify later fails, the live URL
# won't match the recorded hash — which is exactly what drift-check is
# supposed to catch on the next tick. If a salon has no recorded expected
# hash yet (never published via new pipeline), we report it as
# "no_baseline" — not a drift failure, a setup gap.
#
# Runs hourly via /etc/systemd/system/cms-drift-check.timer.

set -u

SITES_ROOT="/opt/enrich-cms/sites"
LOG_DIR="/var/log/cms-drift"
LOG_FILE="${LOG_DIR}/drift-$(date -u +%Y-%m).log"
EXPECTED_FILE="${LOG_DIR}/expected-hashes.tsv"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR"
touch "$EXPECTED_FILE"
: > /tmp/cms-drift-run.$$.tmp

# Load expected hash per slug. TSV with later lines winning (most recent
# publish per salon). Format: slug\thash\tdomain\ttimestamp
declare -A EXPECTED
while IFS=$'\t' read -r slug hash _domain _ts; do
  [ -z "$slug" ] && continue
  EXPECTED[$slug]=$hash
done < "$EXPECTED_FILE"

total=0
ok=0
fail=0
no_baseline=0

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
    if [ -z "$live_hash" ] || [ "$live_hash" = "null" ]; then
      # 200 but no hash = /deploy.json was served but lacks a hash field.
      echo "${TS}  ${slug}  ${target}  ${host}  deploy_json_missing_hash  (200 OK, body=${body:0:120})" >> /tmp/cms-drift-run.$$.tmp
      fail=$((fail+1))
      continue
    fi

    # Compare against expected hash from last successful publish.
    expected_hash="${EXPECTED[$slug]:-}"
    if [ -z "$expected_hash" ]; then
      # No baseline recorded yet — this salon has never been published via
      # the new pipeline that writes expected-hashes.tsv. Not a failure;
      # record so Sean can see which salons still need a first publish.
      no_baseline=$((no_baseline+1))
      echo "${TS}  ${slug}  ${target}  ${host}  no_baseline  live=${live_hash}" >> /tmp/cms-drift-run.$$.tmp
      continue
    fi

    if [ "$live_hash" = "$expected_hash" ]; then
      ok=$((ok+1))
      continue
    fi

    # Hash mismatch — live URL is serving a different build than CMS's
    # last successful publish. This is real drift: stale cache, wrong dir,
    # a different service writing to the web root, etc.
    echo "${TS}  ${slug}  ${target}  ${host}  hash_mismatch  expected=${expected_hash}  live=${live_hash}" >> /tmp/cms-drift-run.$$.tmp
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
  echo "# --- run ${TS}  total=${total}  ok=${ok}  drifted=${fail}  no_baseline=${no_baseline} ---" >> "$LOG_FILE"
  cat /tmp/cms-drift-run.$$.tmp >> "$LOG_FILE"
fi

# Always emit a one-line summary to stderr (captured by journald when run
# under systemd, visible in journalctl -u cms-drift-check.service).
>&2 echo "[cms-drift-check] ${TS}  total=${total}  ok=${ok}  drifted=${fail}  no_baseline=${no_baseline}"

rm -f /tmp/cms-drift-run.$$.tmp

# Exit non-zero ONLY on real drift (hash mismatch or fetch failure) — not
# on no_baseline salons. no_baseline just means "never published yet via
# new pipeline," which is expected during rollout; surfacing it as a
# systemd failure would drown the real signal.
[ "$fail" -eq 0 ] && exit 0 || exit 1
