#!/usr/bin/env bash
#
# Deploy the `staging` branch to the peerify-staging PM2 process.
#
# Every step below fails loudly and stops the script on the first problem —
# no silent continuation. This exists because of a real incident where a
# manual deploy silently left the standalone build's static assets stale
# (see Step 5 / Step 8 for the exact checks that would have caught it).
#
# Never touches the `peerify` (prod) PM2 process except to confirm, before
# and after, that it was not disturbed.

set -euo pipefail

# --- Expected layout (verified against disk below, not trusted blindly) ---
EXPECTED_PROJECT_DIR="/home/tim/apps/peerify-staging/circles/circles"
ENV_FILE="/home/tim/apps/peerify-staging/circles/.env.local"
EXPECTED_STANDALONE_ROOT="${EXPECTED_PROJECT_DIR}/.next/standalone/apps/peerify-staging/circles/circles"
EXPECTED_HOST="peerify"
EXPECTED_BRANCH="staging"
EXPECTED_PORT="3001"
PM2_STAGING="peerify-staging"
PM2_PROD="peerify"

CURRENT_STEP=0
STEP_RESULTS=()

fail() {
    echo >&2
    echo "########################################################" >&2
    echo "# DEPLOY FAILED at Step ${CURRENT_STEP}" >&2
    echo "# $*" >&2
    echo "########################################################" >&2
    echo >&2
    echo "Aborted. No further steps were executed." >&2
    exit 1
}

step_ok() {
    echo "OK: $*"
    STEP_RESULTS+=("Step ${CURRENT_STEP}: PASS - $*")
}

# ---------------------------------------------------------------------------
CURRENT_STEP=1
echo "=== Step 1: Verify environment ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$SCRIPT_DIR" != "$EXPECTED_PROJECT_DIR" ]; then
    fail "Running from '$SCRIPT_DIR', expected '$EXPECTED_PROJECT_DIR'."
fi

ACTUAL_HOST="$(hostname)"
if [ "$ACTUAL_HOST" != "$EXPECTED_HOST" ]; then
    fail "Unexpected hostname '$ACTUAL_HOST' (expected '$EXPECTED_HOST'). Refusing to run — wrong box class of incident."
fi

ACTUAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$ACTUAL_BRANCH" != "$EXPECTED_BRANCH" ]; then
    fail "On branch '$ACTUAL_BRANCH', expected '$EXPECTED_BRANCH'. Refusing to deploy."
fi

if [ ! -f "$ENV_FILE" ]; then
    fail "Env file not found at $ENV_FILE (expected one level up from project dir)."
fi

step_ok "dir=$SCRIPT_DIR host=$ACTUAL_HOST branch=$ACTUAL_BRANCH"

# ---------------------------------------------------------------------------
CURRENT_STEP=2
echo "=== Step 2: Build ==="

# Source staging env so build-time NEXT_PUBLIC_* vars are baked correctly
# (mirrors scripts/deploy-peerify.sh's pattern for prod).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if ! bun run build; then
    fail "'bun run build' failed. See output above."
fi

step_ok "bun run build completed"

# ---------------------------------------------------------------------------
CURRENT_STEP=3
echo "=== Step 3: Verify BUILD_ID ==="

BUILD_ID_FILE="$SCRIPT_DIR/.next/BUILD_ID"
if [ ! -f "$BUILD_ID_FILE" ]; then
    fail "$BUILD_ID_FILE does not exist after build."
fi

BUILD_ID="$(cat "$BUILD_ID_FILE")"
if [ -z "$BUILD_ID" ]; then
    fail "$BUILD_ID_FILE is empty."
fi

echo "BUILD_ID: $BUILD_ID"
step_ok "BUILD_ID = $BUILD_ID"

# ---------------------------------------------------------------------------
CURRENT_STEP=4
echo "=== Step 4: Copy public/ and .next/static into the standalone dir ==="

# Discover the real standalone root instead of trusting EXPECTED_STANDALONE_ROOT
# blindly: find the actual server.js on disk (pruning node_modules, which can
# ship its own files named server.js, e.g. react-dom/server.js).
mapfile -t FOUND_SERVERS < <(
    find "$SCRIPT_DIR/.next/standalone" -path "*/node_modules" -prune -o -type f -name "server.js" -print
)

if [ "${#FOUND_SERVERS[@]}" -eq 0 ]; then
    fail "No server.js found under .next/standalone (excluding node_modules) — standalone output missing."
fi

STANDALONE_ROOT=""
for f in "${FOUND_SERVERS[@]}"; do
    if [ "$(dirname "$f")" = "$EXPECTED_STANDALONE_ROOT" ]; then
        STANDALONE_ROOT="$EXPECTED_STANDALONE_ROOT"
    fi
done

if [ -z "$STANDALONE_ROOT" ]; then
    fail "Expected standalone root not found on disk: $EXPECTED_STANDALONE_ROOT
Found server.js instead at: ${FOUND_SERVERS[*]}
The standalone layout appears to have changed — update EXPECTED_STANDALONE_ROOT after confirming the new layout, do not guess."
fi

step_ok "Confirmed standalone root on disk: $STANDALONE_ROOT"

if [ ! -d "$SCRIPT_DIR/public" ]; then
    fail "Source directory missing: $SCRIPT_DIR/public"
fi
if [ ! -d "$SCRIPT_DIR/.next/static" ]; then
    fail "Source directory missing: $SCRIPT_DIR/.next/static (build did not produce it)"
fi

rm -rf "${STANDALONE_ROOT}/public"
cp -r "$SCRIPT_DIR/public" "${STANDALONE_ROOT}/public"

rm -rf "${STANDALONE_ROOT}/.next/static"
cp -r "$SCRIPT_DIR/.next/static" "${STANDALONE_ROOT}/.next/static"

step_ok "Copied public/ and .next/static into $STANDALONE_ROOT"

# ---------------------------------------------------------------------------
CURRENT_STEP=5
echo "=== Step 5: Verify the copy actually landed ==="

if [ ! -d "${STANDALONE_ROOT}/.next/static" ] || [ -z "$(ls -A "${STANDALONE_ROOT}/.next/static" 2>/dev/null)" ]; then
    fail "${STANDALONE_ROOT}/.next/static is missing or empty after copy. THIS IS TONIGHT'S FAILURE MODE."
fi

NESTED_BUILD_ID_FILE="${STANDALONE_ROOT}/.next/BUILD_ID"
if [ ! -f "$NESTED_BUILD_ID_FILE" ]; then
    fail "${NESTED_BUILD_ID_FILE} does not exist. THIS IS TONIGHT'S FAILURE MODE."
fi

NESTED_BUILD_ID="$(cat "$NESTED_BUILD_ID_FILE")"
if [ "$NESTED_BUILD_ID" != "$BUILD_ID" ]; then
    fail "BUILD_ID mismatch — top-level=$BUILD_ID nested=$NESTED_BUILD_ID. Standalone build is stale. THIS IS TONIGHT'S FAILURE MODE."
fi

step_ok "Nested static present and nested BUILD_ID ($NESTED_BUILD_ID) matches top-level"

# ---------------------------------------------------------------------------
CURRENT_STEP=6
echo "=== Step 6: Restart peerify-staging only ==="

pm2_field() {
    # pm2_field <app-name> <python-expr-on-p>
    pm2 jlist | python3 -c "
import json, sys
data = json.load(sys.stdin)
for p in data:
    if p['name'] == '$1':
        print($2)
        sys.exit(0)
sys.exit(1)
"
}

PROD_BASELINE="$(pm2_field "$PM2_PROD" "f\"{p['pid']} {p['pm2_env']['pm_uptime']}\"")" \
    || fail "Could not find prod PM2 process '$PM2_PROD' to capture a baseline. Refusing to proceed."
echo "Prod baseline (pid uptime_ts): $PROD_BASELINE"

# Fresh env for the restart specifically: never trust what the calling shell
# already has exported (this is the exact class of bug that once pushed
# staging's PORT onto prod — see SESSION_LOG.md).
unset PORT
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ "${PORT:-}" != "$EXPECTED_PORT" ]; then
    fail "Freshly-sourced PORT from $ENV_FILE is '${PORT:-<unset>}', expected $EXPECTED_PORT. Refusing to restart."
fi
step_ok "Freshly-sourced PORT confirmed as $EXPECTED_PORT"

if ! PORT="$EXPECTED_PORT" pm2 restart "$PM2_STAGING" --update-env; then
    fail "'pm2 restart $PM2_STAGING' failed."
fi

if ! pm2 save; then
    fail "'pm2 save' failed after restart."
fi

STAGING_STATUS=""
for i in $(seq 1 10); do
    STAGING_STATUS="$(pm2_field "$PM2_STAGING" "f\"{p['pm2_env']['status']} pid={p['pid']} port={p['pm2_env']['env'].get('PORT')}\"" || true)"
    if [[ "$STAGING_STATUS" == online* ]]; then
        break
    fi
    sleep 1
done

if [[ "$STAGING_STATUS" != online* ]]; then
    fail "Staging process not online after restart (status: '${STAGING_STATUS:-<none>}')."
fi
step_ok "Staging ($PM2_STAGING) status: $STAGING_STATUS"

PROD_AFTER="$(pm2_field "$PM2_PROD" "f\"{p['pid']} {p['pm2_env']['pm_uptime']}\"")" \
    || fail "Could not find prod PM2 process '$PM2_PROD' after restart — verify manually right now."

if [ "$PROD_AFTER" != "$PROD_BASELINE" ]; then
    fail "PROD WAS AFFECTED by this deploy. Before: [$PROD_BASELINE] After: [$PROD_AFTER]. Investigate immediately."
fi
step_ok "Prod ($PM2_PROD) pid/uptime unchanged: $PROD_AFTER"

# ---------------------------------------------------------------------------
CURRENT_STEP=7
echo "=== Step 7: HTTP root check ==="

HTTP_CODE="000"
for i in $(seq 1 10); do
    HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${EXPECTED_PORT}/" || echo "000")"
    if [ "$HTTP_CODE" = "200" ]; then
        break
    fi
    sleep 1
done

if [ "$HTTP_CODE" != "200" ]; then
    fail "GET http://localhost:${EXPECTED_PORT}/ returned '$HTTP_CODE' (expected 200) after retries."
fi
step_ok "GET / -> HTTP $HTTP_CODE"

# ---------------------------------------------------------------------------
CURRENT_STEP=8
echo "=== Step 8: HTTP static asset check ==="

ASSET_FILE="$(find "${STANDALONE_ROOT}/.next/static/css" -type f -name '*.css' | head -1)"
if [ -z "$ASSET_FILE" ]; then
    fail "No .css file found under ${STANDALONE_ROOT}/.next/static/css to test."
fi

ASSET_REL="${ASSET_FILE#${STANDALONE_ROOT}/.next/static/}"
ASSET_URL="http://localhost:${EXPECTED_PORT}/_next/static/${ASSET_REL}"

ASSET_CURL_OUTPUT="$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$ASSET_URL")"
read -r ASSET_CODE ASSET_SIZE <<< "$ASSET_CURL_OUTPUT"

if [ "$ASSET_CODE" != "200" ]; then
    fail "Static asset $ASSET_URL returned HTTP $ASSET_CODE (expected 200). THIS IS TONIGHT'S FAILURE MODE."
fi
if [ "$ASSET_SIZE" -lt 100 ]; then
    fail "Static asset $ASSET_URL returned only $ASSET_SIZE bytes — looks like a 404 page or empty response, not a real asset."
fi
step_ok "GET $ASSET_URL -> HTTP $ASSET_CODE, ${ASSET_SIZE} bytes"

# ---------------------------------------------------------------------------
echo
echo "======================= DEPLOY SUMMARY ======================="
echo "BUILD_ID:            $BUILD_ID"
echo "Standalone root:     $STANDALONE_ROOT"
echo "PM2 staging:         $STAGING_STATUS"
echo "PM2 prod (untouched): $PROD_AFTER"
echo "HTTP  /            : $HTTP_CODE"
echo "HTTP  static asset : $ASSET_CODE (${ASSET_SIZE} bytes)"
echo "                      $ASSET_URL"
echo "----------------------------------------------------------------"
for r in "${STEP_RESULTS[@]}"; do
    echo "$r"
done
echo "================================================================"
echo "STAGING DEPLOY SUCCEEDED."
