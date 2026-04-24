#!/bin/bash
# smoke-cms.sh — end-user smoke test against https://cms.enrichco.us
#
# Usage: ./scripts/smoke-cms.sh [--base-url URL]
#   Default base URL: https://cms.enrichco.us
#
# Exit 0 = all checks passed
# Exit 1 = one or more checks failed

set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-https://cms.enrichco.us}"

# Parse optional --base-url override
while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url) BASE_URL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── helpers ───────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
RESULTS=()

check() {
  local name="$1"
  local result="$2"   # "PASS" or "FAIL"
  local detail="$3"
  RESULTS+=("$(printf "  %-52s  %s  %s" "$name" "$result" "$detail")")
  if [[ "$result" == "PASS" ]]; then
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
}

http_code() {
  curl -sk -o /dev/null -w "%{http_code}" --max-time 15 "$1"
}

http_body() {
  curl -sk -L --max-time 15 "$1"
}

# ── check 1: /api/health ──────────────────────────────────────────────────────
HEALTH_BODY="$(http_body "${BASE_URL}/api/health")"
HEALTH_CODE="$(http_code "${BASE_URL}/api/health")"
if [[ "$HEALTH_CODE" == "200" ]] && \
   echo "$HEALTH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok' and d.get('db')=='ok'" 2>/dev/null; then
  check "/api/health → 200 {status:ok, db:ok}" "PASS" ""
else
  check "/api/health → 200 {status:ok, db:ok}" "FAIL" "got HTTP $HEALTH_CODE body=${HEALTH_BODY:0:120}"
fi

# ── check 2: /login returns 200 HTML ─────────────────────────────────────────
LOGIN_CODE="$(http_code "${BASE_URL}/login")"
LOGIN_BODY="$(http_body "${BASE_URL}/login")"
if [[ "$LOGIN_CODE" == "200" ]] && echo "$LOGIN_BODY" | grep -qi '<html'; then
  check "/login → 200 HTML" "PASS" ""
else
  check "/login → 200 HTML" "FAIL" "got HTTP $LOGIN_CODE"
fi

# ── check 3: /api/salons → 401 (auth-gated) ──────────────────────────────────
SALONS_CODE="$(http_code "${BASE_URL}/api/salons")"
if [[ "$SALONS_CODE" == "401" ]]; then
  check "/api/salons → 401 (auth-gated)" "PASS" ""
elif [[ "$SALONS_CODE" == "200" ]]; then
  check "/api/salons → 401 (auth-gated)" "FAIL" "got 200 — auth is NOT enforced (MISCONFIG)"
elif [[ "$SALONS_CODE" == "500" ]]; then
  check "/api/salons → 401 (auth-gated)" "FAIL" "got 500 — server error"
else
  check "/api/salons → 401 (auth-gated)" "FAIL" "got HTTP $SALONS_CODE"
fi

# ── check 4: home page has _next/static CSS chunk and that CSS loads ─────────
HOME_BODY="$(http_body "${BASE_URL}/")"
HOME_CODE="$(http_code "${BASE_URL}/")"
CSS_URL=""
if [[ "$HOME_CODE" == "200" ]] || [[ "$HOME_CODE" == "307" ]] || [[ "$HOME_CODE" == "302" ]]; then
  # Extract first _next/static CSS link
  CSS_URL="$(echo "$HOME_BODY" | grep -oE '/_next/static/chunks/[^"]+\.css' | head -1 || true)"
fi

if [[ -n "$CSS_URL" ]]; then
  CSS_CODE="$(http_code "${BASE_URL}${CSS_URL}")"
  if [[ "$CSS_CODE" == "200" ]]; then
    check "Home page has _next/static CSS + CSS loads" "PASS" "$CSS_URL"
  else
    check "Home page has _next/static CSS + CSS loads" "FAIL" "CSS URL found but HTTP $CSS_CODE for $CSS_URL"
  fi
else
  # Home may redirect to /login — check /login for CSS instead
  LOGIN_CSS_URL="$(echo "$LOGIN_BODY" | grep -oE '/_next/static/chunks/[^"]+\.css' | head -1 || true)"
  if [[ -n "$LOGIN_CSS_URL" ]]; then
    LOGIN_CSS_CODE="$(http_code "${BASE_URL}${LOGIN_CSS_URL}")"
    if [[ "$LOGIN_CSS_CODE" == "200" ]]; then
      check "Page has _next/static CSS + CSS loads" "PASS" "$LOGIN_CSS_URL (from /login)"
    else
      check "Page has _next/static CSS + CSS loads" "FAIL" "CSS link found on /login but HTTP $LOGIN_CSS_CODE"
    fi
  else
    check "Page has _next/static CSS + CSS loads" "FAIL" "no _next/static CSS link found on home or /login"
  fi
fi

# ── check 5: at least one _next/static JS chunk loads ────────────────────────
JS_URL=""
# Try home first, fall back to login page
for PAGE_BODY in "$HOME_BODY" "$LOGIN_BODY"; do
  JS_URL="$(echo "$PAGE_BODY" | grep -oE '/_next/static/chunks/[^"]+\.js' | head -1 || true)"
  [[ -n "$JS_URL" ]] && break
done

if [[ -n "$JS_URL" ]]; then
  JS_CODE="$(http_code "${BASE_URL}${JS_URL}")"
  if [[ "$JS_CODE" == "200" ]]; then
    check "_next/static JS chunk loads" "PASS" "$JS_URL"
  else
    check "_next/static JS chunk loads" "FAIL" "HTTP $JS_CODE for $JS_URL"
  fi
else
  check "_next/static JS chunk loads" "FAIL" "no _next/static JS link found on home or /login"
fi

# ── check 6: /api/salon/<slug> → 401 (endpoint alive, auth enforced) ─────────
SALON_SLUG_CODE="$(http_code "${BASE_URL}/api/salon/vanity-nails-spa")"
if [[ "$SALON_SLUG_CODE" == "401" ]]; then
  check "/api/salon/vanity-nails-spa → 401" "PASS" ""
elif [[ "$SALON_SLUG_CODE" == "404" ]]; then
  # Slug may not exist on this env — 404 is also acceptable (route alive, slug unknown)
  check "/api/salon/vanity-nails-spa → 401 or 404" "PASS" "got 404 (slug may not exist here)"
elif [[ "$SALON_SLUG_CODE" == "500" ]]; then
  check "/api/salon/vanity-nails-spa → 401 or 404" "FAIL" "got 500 — server error"
else
  check "/api/salon/vanity-nails-spa → 401" "FAIL" "got HTTP $SALON_SLUG_CODE"
fi

# ── results table ─────────────────────────────────────────────────────────────
echo ""
echo "  Smoke test: $BASE_URL"
echo "  ──────────────────────────────────────────────────────────────────"
for r in "${RESULTS[@]}"; do
  echo "$r"
done
echo "  ──────────────────────────────────────────────────────────────────"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo "  Result: ALL $PASS CHECKS PASSED"
  echo ""
  exit 0
else
  echo "  Result: $FAIL FAILED / $PASS PASSED"
  echo ""
  exit 1
fi
