#!/bin/bash
# validate-all-salons.sh — pre-deploy / pre-commit schema guard
#
# Validates every salon.json against the current salonSchema.
#
# Usage:
#   ./scripts/validate-all-salons.sh              # validates prod server (via gcloud IAP)
#   SITES_DIR=/path/to/local/sites ./scripts/validate-all-salons.sh  # local override
#
# Exit 0 = all pass
# Exit 1 = one or more schema failures
# Exit 2 = infrastructure error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== CMS Salon Schema Validator ==="
echo "Schema: src/lib/schemas/salon.ts"
if [[ -n "${SITES_DIR:-}" ]]; then
  echo "Source: local $SITES_DIR"
else
  echo "Source: prod server ${GCP_INSTANCE:-mangotemplate-web-server} via gcloud IAP"
fi
echo ""

cd "$REPO_ROOT"

node "$SCRIPT_DIR/validate-all-salons.mjs"
EXIT=$?

if [[ $EXIT -eq 0 ]]; then
  echo "Schema guard: PASSED"
elif [[ $EXIT -eq 1 ]]; then
  echo "Schema guard: FAILED — fix the salons listed above before deploying"
else
  echo "Schema guard: ERROR — infrastructure problem (check gcloud auth)"
fi

exit $EXIT
