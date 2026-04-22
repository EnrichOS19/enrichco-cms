#!/usr/bin/env bash
# One-time migration — normalize salon.json `domain` + `stagingDomain` to
# lowercase and consolidate /var/www directories for salons whose domain
# field was stored with mixed-case.
#
# Runs on mangotemplate-web-server. Requires sudo for /var/www operations.
# Idempotent: safe to re-run.
#
# Audit:  every action is echoed; nothing is deleted without being moved
#         first. Mixed-case dir is renamed to lowercase only if the
#         lowercase target doesn't already exist with newer content.
#
# Target salons (identified by Webber audit 2026-04-20):
#   arapahoe-snappy-nails        → ASNsalon.com
#   cali-nails-spa-vacaville     → CaliNailsandSpaVacaville.com
#   nailography-chicago-website  → Nailographysalon.com
#   nailvibe-cool-springs        → NailVibeCoolSprings.com

set -euo pipefail

SITES_ROOT="/opt/enrich-cms/sites"
WEB_ROOT="/var/www"

SLUGS=(
  arapahoe-snappy-nails
  cali-nails-spa-vacaville
  nailography-chicago-website
  nailvibe-cool-springs
)

echo "=== Lowercase-domain migration — starting ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

for slug in "${SLUGS[@]}"; do
  echo "── $slug ──────────────────────────────────────────────────────"
  cfg="${SITES_ROOT}/${slug}/config/salon.json"
  if [ ! -f "$cfg" ]; then
    echo "  SKIP: $cfg not found"
    continue
  fi

  # Read current domain + stagingDomain values.
  domain_raw=$(sudo jq -r '.domain // ""' "$cfg")
  staging_raw=$(sudo jq -r '.stagingDomain // ""' "$cfg")
  domain_lower=$(echo "$domain_raw" | tr '[:upper:]' '[:lower:]')
  staging_lower=$(echo "$staging_raw" | tr '[:upper:]' '[:lower:]')

  echo "  salon.json domain        : $domain_raw  →  $domain_lower"
  echo "  salon.json stagingDomain : $staging_raw  →  $staging_lower"

  # ── Step 1: lowercase both fields in salon.json ─────────────────────────
  if [ "$domain_raw" != "$domain_lower" ] || [ "$staging_raw" != "$staging_lower" ]; then
    ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
    sudo cp -p "$cfg" "${cfg}.bak.migrate-${ts}"
    sudo jq --arg d "$domain_lower" --arg s "$staging_lower" \
      '.domain = $d | (if (.stagingDomain // "") != "" then .stagingDomain = $s else . end)' \
      "$cfg" | sudo tee "${cfg}.tmp" > /dev/null
    sudo mv "${cfg}.tmp" "$cfg"
    # Preserve ownership from the backup (same as original)
    sudo chown --reference="${cfg}.bak.migrate-${ts}" "$cfg"
    sudo chmod --reference="${cfg}.bak.migrate-${ts}" "$cfg"
    echo "  [OK] salon.json normalized (backup: salon.json.bak.migrate-${ts})"
  else
    echo "  [SKIP] salon.json already lowercase"
  fi

  # ── Step 2: reconcile /var/www/{mixed}/ and /var/www/{lower}/ ──────────
  if [ -n "$domain_raw" ] && [ "$domain_raw" != "$domain_lower" ]; then
    mixed="${WEB_ROOT}/${domain_raw}"
    lower="${WEB_ROOT}/${domain_lower}"

    if [ -d "$mixed" ] && [ -d "$lower" ]; then
      # Both exist — keep the one with the newer public/index.html.
      mixed_mtime=$(sudo stat -c '%Y' "${mixed}/public/index.html" 2>/dev/null || echo 0)
      lower_mtime=$(sudo stat -c '%Y' "${lower}/public/index.html" 2>/dev/null || echo 0)
      echo "  both dirs exist  mixed_mtime=$mixed_mtime  lower_mtime=$lower_mtime"

      if [ "$mixed_mtime" -gt "$lower_mtime" ]; then
        # Mixed-case dir is newer — replace lowercase with it.
        echo "  mixed-case dir has newer content — replacing lowercase"
        sudo mv "$lower" "${lower}.pre-migrate.$(date -u +%s)"
        sudo mv "$mixed" "$lower"
        echo "  [OK] mixed-case → lowercase  (old lowercase backed up with .pre-migrate suffix)"
      else
        # Lowercase is newer or equal — keep it, remove the dead mixed-case.
        echo "  lowercase dir is newer (or tied) — removing dead mixed-case dir"
        sudo mv "$mixed" "${mixed}.dead.$(date -u +%s)"
        echo "  [OK] mixed-case renamed to .dead.<ts> (delete manually after verification)"
      fi
    elif [ -d "$mixed" ]; then
      echo "  only mixed-case dir exists — renaming to lowercase"
      sudo mv "$mixed" "$lower"
      echo "  [OK] $mixed → $lower"
    elif [ -d "$lower" ]; then
      echo "  only lowercase dir exists — nothing to reconcile"
    else
      echo "  neither dir exists — next publish will create $lower"
    fi
  fi

  # ── Step 3: nginx sanity check ──────────────────────────────────────────
  # Find the nginx server block for this domain and verify its `root`
  # directive points at a lowercase path (no change made — reports only).
  if [ -n "$domain_lower" ]; then
    conf=$(sudo grep -l "server_name ${domain_lower}\\b" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || echo "")
    if [ -n "$conf" ]; then
      root_line=$(sudo grep -E '^\s*root\s' "$conf" | head -1 | awk '{print $2}' | tr -d ';')
      echo "  nginx conf: $conf"
      echo "  nginx root: $root_line"
      if [ -n "$root_line" ] && [ "$root_line" != "$(echo "$root_line" | tr '[:upper:]' '[:lower:]')" ]; then
        echo "  WARN: nginx 'root' has uppercase letters; next publish will mismatch"
      fi
    else
      echo "  WARN: no nginx server block found for server_name ${domain_lower}"
    fi
  fi

  echo ""
done

echo "=== Migration complete ==="
echo ""
echo "Next steps:"
echo "  1. Review .bak.migrate-* files under /opt/enrich-cms/sites/*/config/"
echo "  2. Review .dead.* directories under /var/www/ (delete after a few days)"
echo "  3. Trigger a publish for each migrated salon via CMS UI or API —"
echo "     the new Layer-2 post-deploy verification will confirm live URL"
echo "     actually serves the fresh build."
