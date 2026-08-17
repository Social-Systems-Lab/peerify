#!/usr/bin/env bash
#
# Shared atomic-release deploy logic for deploy-staging.sh / deploy-peerify.sh.
#
# Background: on 2026-08-02 (staging) and 2026-08-17 (prod), a deploy that was
# interrupted between "wipe the live standalone dir's static assets" and
# "copy the new ones in" left the live PM2 process running with nothing on
# disk to serve — site up, but unstyled/broken, until someone noticed and
# re-ran the full deploy. Prod's script also did `rm -rf .next`, which -
# because the live standalone dir was nested inside `.next` - deleted the
# entire live directory (server.js included), not just static assets.
#
# Fix: never mutate the directory PM2 is actually serving from. Instead:
#   - `.next` is pure build scratch. Nothing live reads from it; safe to wipe.
#   - Each deploy assembles a complete, self-contained build under
#     releases/<timestamp>-<gitsha>/, fully isolated from anything live.
#   - That release is verified in place (BUILD_ID, static/public presence,
#     server.js present) before it is ever referenced by anything live.
#   - `current` is a symlink (living at dirname(PROJECT_DIR)/current) that PM2's
#     --cwd/script path point at. The only operation that touches the live
#     path is a single `mv -T` of a freshly-created symlink onto `current` -
#     an atomic rename(2) on the same filesystem, so there is no instant at
#     which `current` points at a partial or missing build.
#   - PM2 is only restarted after the swap is verified complete.
#
# If this script is interrupted at any point before Step 6 (the swap),
# `current` was never touched: the live process keeps serving the previous
# release exactly as it was, and re-running the script just tries again from
# a fresh release directory. No partial state, no manual recovery.
#
# This file is meant to be `source`d, not executed directly. The caller
# (deploy-staging.sh / deploy-peerify.sh) sets the config variables below,
# sources this file, then calls `run_atomic_deploy`.
#
# Required config variables:
#   PROJECT_DIR      - absolute path to the app's checkout (holds .next,
#                       public — the build scratch space)
#   ENV_FILE         - env file to source for both build-time and
#                       runtime (restart) env vars
#   EXPECTED_HOST    - hostname this must run on
#   EXPECTED_BRANCH  - git branch this must run on
#   EXPECTED_PORT    - PORT this app's PM2 process listens on
#   NESTED_APP_PATH  - path under .next/standalone/ where server.js lands,
#                       e.g. "apps/peerify-app/circles"
#   PM2_NAME         - PM2 process name for this app
#   PM2_OTHER        - PM2 process name for the sibling app that must be
#                       confirmed untouched before and after
#   RUN_BUN_INSTALL  - "true"/"false" - whether to run
#                       `bun install --frozen-lockfile` before building
# Optional:
#   RELEASES_TO_KEEP - how many releases to retain after a successful
#                       deploy (default 5)
#
# releases/ and the 'current' symlink live in dirname(PROJECT_DIR) — one
# level above the app checkout, not inside it. This is deliberate: an
# earlier version of this script put releases/ inside PROJECT_DIR, and the
# very first test run broke because `next build`'s own tsc pass scanned
# into releases/<previous-id>/src/... (a full copy of a prior build) and
# tried to type-check it as if it were project source. dirname(PROJECT_DIR)
# is outside the Next.js app's tsconfig scope for both peerify-app and
# peerify-staging's layouts, so it's never seen by the build. It also
# already has its own repo-root .gitignore for exactly this kind of
# deploy-local artifact.
#
# The caller must have `set -euo pipefail` active (this file assumes it).

: "${RELEASES_TO_KEEP:=5}"

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

_require_config() {
    local missing=()
    local v
    for v in PROJECT_DIR ENV_FILE EXPECTED_HOST EXPECTED_BRANCH EXPECTED_PORT \
             NESTED_APP_PATH PM2_NAME PM2_OTHER RUN_BUN_INSTALL; do
        if [ -z "${!v:-}" ]; then
            missing+=("$v")
        fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        fail "deploy-common.sh: missing required config variable(s): ${missing[*]}"
    fi

    RELEASES_ROOT="$(dirname "$PROJECT_DIR")"
}

step_verify_environment() {
    CURRENT_STEP=1
    echo "=== Step 1: Verify environment ==="

    cd "$PROJECT_DIR"

    local actual_host actual_branch
    actual_host="$(hostname)"
    if [ "$actual_host" != "$EXPECTED_HOST" ]; then
        fail "Unexpected hostname '$actual_host' (expected '$EXPECTED_HOST'). Refusing to run — wrong box class of incident."
    fi

    actual_branch="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$actual_branch" != "$EXPECTED_BRANCH" ]; then
        fail "On branch '$actual_branch', expected '$EXPECTED_BRANCH'. Refusing to deploy."
    fi

    if [ ! -f "$ENV_FILE" ]; then
        fail "Env file not found at $ENV_FILE."
    fi

    step_ok "dir=$PROJECT_DIR host=$actual_host branch=$actual_branch"
}

step_build() {
    CURRENT_STEP=2
    echo "=== Step 2: Build ==="

    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a

    export GIT_SHA
    GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    export BUILD_TIME
    BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    export NODE_ENV=production

    if [ "$RUN_BUN_INSTALL" = "true" ]; then
        if ! bun install --frozen-lockfile; then
            fail "'bun install --frozen-lockfile' failed. See output above."
        fi
    fi

    # .next is pure build scratch under this scheme - nothing live reads
    # from it (the live process runs out of releases/<id>/ via the
    # 'current' symlink), so wiping it unconditionally is safe.
    rm -rf .next

    if ! bun run build; then
        fail "'bun run build' failed. See output above."
    fi

    step_ok "bun run build completed (GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME)"
}

step_locate_standalone() {
    CURRENT_STEP=3
    echo "=== Step 3: Verify BUILD_ID and locate standalone output ==="

    BUILD_ID_FILE="$PROJECT_DIR/.next/BUILD_ID"
    if [ ! -f "$BUILD_ID_FILE" ]; then
        fail "$BUILD_ID_FILE does not exist after build."
    fi
    BUILD_ID="$(cat "$BUILD_ID_FILE")"
    if [ -z "$BUILD_ID" ]; then
        fail "$BUILD_ID_FILE is empty."
    fi
    echo "BUILD_ID: $BUILD_ID"

    local expected_standalone_root="$PROJECT_DIR/.next/standalone/$NESTED_APP_PATH"
    local found_servers=()
    mapfile -t found_servers < <(
        find "$PROJECT_DIR/.next/standalone" -path "*/node_modules" -prune -o -type f -name "server.js" -print
    )
    if [ "${#found_servers[@]}" -eq 0 ]; then
        fail "No server.js found under .next/standalone (excluding node_modules) — standalone output missing."
    fi

    STANDALONE_ROOT=""
    local f
    for f in "${found_servers[@]}"; do
        if [ "$(dirname "$f")" = "$expected_standalone_root" ]; then
            STANDALONE_ROOT="$expected_standalone_root"
        fi
    done
    if [ -z "$STANDALONE_ROOT" ]; then
        fail "Expected standalone root not found on disk: $expected_standalone_root
Found server.js instead at: ${found_servers[*]}
The standalone layout appears to have changed — update NESTED_APP_PATH after confirming the new layout, do not guess."
    fi

    step_ok "BUILD_ID = $BUILD_ID; standalone root = $STANDALONE_ROOT"
}

step_assemble_release() {
    CURRENT_STEP=4
    echo "=== Step 4: Assemble new release (fully isolated from the live 'current') ==="

    if [ ! -d "$PROJECT_DIR/public" ]; then
        fail "Source directory missing: $PROJECT_DIR/public"
    fi
    if [ ! -d "$PROJECT_DIR/.next/static" ]; then
        fail "Source directory missing: $PROJECT_DIR/.next/static (build did not produce it)"
    fi

    RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-${GIT_SHA}"
    RELEASE_DIR="$RELEASES_ROOT/releases/$RELEASE_ID"

    mkdir -p "$RELEASES_ROOT/releases"
    if [ -e "$RELEASE_DIR" ]; then
        fail "Release dir $RELEASE_DIR already exists — refusing to overwrite. Re-run the deploy."
    fi
    mkdir "$RELEASE_DIR"

    # Copy the whole standalone tree (server.js, node_modules, server
    # chunks) into the new release. STANDALONE_ROOT is scratch output from
    # the build that just ran - not the live path - so this is purely
    # additive with respect to anything currently serving traffic.
    cp -r "$STANDALONE_ROOT/." "$RELEASE_DIR/"

    rm -rf "$RELEASE_DIR/.next/static"
    cp -r "$PROJECT_DIR/.next/static" "$RELEASE_DIR/.next/static"

    rm -rf "$RELEASE_DIR/public"
    cp -r "$PROJECT_DIR/public" "$RELEASE_DIR/public"

    if [ -f "$PROJECT_DIR/VERSION" ]; then
        cp "$PROJECT_DIR/VERSION" "$RELEASE_DIR/VERSION"
    fi

    step_ok "Assembled release at $RELEASE_DIR"
}

step_verify_release() {
    CURRENT_STEP=5
    echo "=== Step 5: Verify the new release is complete, before it goes anywhere near 'current' ==="

    if [ ! -d "${RELEASE_DIR}/.next/static" ] || [ -z "$(ls -A "${RELEASE_DIR}/.next/static" 2>/dev/null)" ]; then
        fail "${RELEASE_DIR}/.next/static is missing or empty."
    fi
    if [ ! -d "${RELEASE_DIR}/public" ] || [ -z "$(ls -A "${RELEASE_DIR}/public" 2>/dev/null)" ]; then
        fail "${RELEASE_DIR}/public is missing or empty."
    fi

    if [ ! -f "${RELEASE_DIR}/public/peerify/fans.jpg" ]; then
        if [ -f "${RELEASE_DIR}/public/fans.jpg" ]; then
            fail "public/peerify assets were copied FLATTENED to public/ root instead of public/peerify/. Copy step is broken."
        else
            fail "${RELEASE_DIR}/public/peerify/fans.jpg not found — public/peerify assets missing entirely."
        fi
    fi

    local nested_build_id_file="${RELEASE_DIR}/.next/BUILD_ID"
    if [ ! -f "$nested_build_id_file" ]; then
        fail "${nested_build_id_file} does not exist."
    fi
    local nested_build_id
    nested_build_id="$(cat "$nested_build_id_file")"
    if [ "$nested_build_id" != "$BUILD_ID" ]; then
        fail "BUILD_ID mismatch — top-level=$BUILD_ID nested=$nested_build_id. Release is stale."
    fi

    if [ ! -f "${RELEASE_DIR}/server.js" ]; then
        fail "Could not find server.js at ${RELEASE_DIR}/server.js"
    fi

    step_ok "Release verified: static+public present, BUILD_ID ($nested_build_id) matches, server.js present"
}

step_swap_current() {
    CURRENT_STEP=6
    echo "=== Step 6: Atomic swap — flip 'current' to the new release ==="

    # If PM2 is already running this app, it must already be configured
    # with --cwd pointing at RELEASES_ROOT/current. If it isn't, this box
    # hasn't been migrated onto the releases/current scheme yet, and doing
    # that migration is a deliberate one-time action, not something to
    # infer silently mid-deploy.
    if pm2_field "$PM2_NAME" "p['pid']" >/dev/null 2>&1; then
        local running_cwd
        running_cwd="$(pm2_field "$PM2_NAME" "p['pm2_env'].get('pm_cwd','')")"
        if [ "$running_cwd" != "$RELEASES_ROOT/current" ]; then
            fail "PM2 process '$PM2_NAME' is running with cwd='$running_cwd', not '$RELEASES_ROOT/current'.
This box has not been migrated onto the releases/current scheme yet.
Do the one-time migration manually first: confirm $RELEASES_ROOT/current
points at a valid, verified release, then 'pm2 delete $PM2_NAME' and
'pm2 start $RELEASES_ROOT/current/server.js --name $PM2_NAME --cwd
$RELEASES_ROOT/current --update-env', confirm healthy, 'pm2 save'. Then
re-run this deploy. Refusing to guess at a migration mid-deploy."
        fi
    fi

    ln -sfn "releases/$RELEASE_ID" "$RELEASES_ROOT/current.tmp"
    mv -T "$RELEASES_ROOT/current.tmp" "$RELEASES_ROOT/current"

    local resolved target
    resolved="$(readlink -f "$RELEASES_ROOT/current")"
    target="$(readlink -f "$RELEASE_DIR")"
    if [ "$resolved" != "$target" ]; then
        fail "'current' does not resolve to the new release after swap — got '$resolved', expected '$target'."
    fi

    step_ok "'current' now points at releases/$RELEASE_ID"
}

step_restart_pm2() {
    CURRENT_STEP=7
    echo "=== Step 7: Restart $PM2_NAME only ==="

    local other_baseline
    other_baseline="$(pm2_field "$PM2_OTHER" "f\"{p['pid']} {p['pm2_env']['pm_uptime']}\"")" \
        || fail "Could not find sibling PM2 process '$PM2_OTHER' to capture a baseline. Refusing to proceed."
    echo "Sibling baseline ($PM2_OTHER) (pid uptime_ts): $other_baseline"

    # Fresh env for the restart specifically: never trust what the calling
    # shell already has exported.
    unset PORT
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    PORT="$EXPECTED_PORT"

    local already_running="false"
    if pm2_field "$PM2_NAME" "p['pid']" >/dev/null 2>&1; then
        already_running="true"
    fi

    if [ "$already_running" = "true" ]; then
        if ! PORT="$PORT" NODE_ENV=production pm2 restart "$PM2_NAME" --update-env; then
            fail "'pm2 restart $PM2_NAME' failed."
        fi
    else
        # First-ever start on this box (no existing process). Establishes
        # --cwd pointed at the symlink, which is what makes future restarts
        # safe under this scheme.
        if ! PORT="$PORT" NODE_ENV=production pm2 start "$RELEASES_ROOT/current/server.js" \
            --name "$PM2_NAME" \
            --cwd "$RELEASES_ROOT/current" \
            --update-env; then
            fail "'pm2 start' failed for $PM2_NAME."
        fi
    fi

    if ! pm2 save; then
        fail "'pm2 save' failed after restart."
    fi

    local status=""
    local i
    for i in $(seq 1 10); do
        status="$(pm2_field "$PM2_NAME" "f\"{p['pm2_env']['status']} pid={p['pid']} port={p['pm2_env']['env'].get('PORT')}\"" || true)"
        if [[ "$status" == online* ]]; then
            break
        fi
        sleep 1
    done
    if [[ "$status" != online* ]]; then
        fail "$PM2_NAME not online after restart (status: '${status:-<none>}')."
    fi
    step_ok "$PM2_NAME status: $status"

    local other_after
    other_after="$(pm2_field "$PM2_OTHER" "f\"{p['pid']} {p['pm2_env']['pm_uptime']}\"")" \
        || fail "Could not find sibling PM2 process '$PM2_OTHER' after restart — verify manually right now."
    if [ "$other_after" != "$other_baseline" ]; then
        fail "SIBLING PROCESS $PM2_OTHER WAS AFFECTED by this deploy. Before: [$other_baseline] After: [$other_after]. Investigate immediately."
    fi
    step_ok "Sibling ($PM2_OTHER) pid/uptime unchanged: $other_after"

    PM2_STATUS="$status"
    PM2_OTHER_AFTER="$other_after"
}

step_http_checks() {
    CURRENT_STEP=8
    echo "=== Step 8: HTTP checks ==="

    local http_code="000"
    local i
    for i in $(seq 1 10); do
        http_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${EXPECTED_PORT}/" || echo "000")"
        if [ "$http_code" = "200" ]; then
            break
        fi
        sleep 1
    done
    if [ "$http_code" != "200" ]; then
        fail "GET http://localhost:${EXPECTED_PORT}/ returned '$http_code' (expected 200) after retries."
    fi
    step_ok "GET / -> HTTP $http_code"
    HTTP_CODE="$http_code"

    local asset_file
    asset_file="$(find "${RELEASE_DIR}/.next/static/css" -type f -name '*.css' | head -1)"
    if [ -z "$asset_file" ]; then
        fail "No .css file found under ${RELEASE_DIR}/.next/static/css to test."
    fi
    local asset_rel="${asset_file#${RELEASE_DIR}/.next/static/}"
    local asset_url="http://localhost:${EXPECTED_PORT}/_next/static/${asset_rel}"

    local asset_curl_output asset_code asset_size
    asset_curl_output="$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$asset_url")"
    read -r asset_code asset_size <<< "$asset_curl_output"

    if [ "$asset_code" != "200" ]; then
        fail "Static asset $asset_url returned HTTP $asset_code (expected 200)."
    fi
    if [ "$asset_size" -lt 100 ]; then
        fail "Static asset $asset_url returned only $asset_size bytes — looks like an error page, not a real asset."
    fi
    step_ok "GET $asset_url -> HTTP $asset_code, ${asset_size} bytes"

    ASSET_CODE="$asset_code"
    ASSET_SIZE="$asset_size"
    ASSET_URL="$asset_url"
}

step_prune_releases() {
    CURRENT_STEP=9
    echo "=== Step 9: Prune old releases (keep last $RELEASES_TO_KEEP) ==="

    # Best-effort and non-fatal by construction: no command in this function
    # calls fail()/exit, so a pruning hiccup can never mask an otherwise
    # successful deploy.
    local releases_dir="$RELEASES_ROOT/releases"
    local current_target
    current_target="$(readlink -f "$RELEASES_ROOT/current" 2>/dev/null || true)"

    local all_releases=()
    mapfile -t all_releases < <(ls -1 "$releases_dir" 2>/dev/null | sort)
    local count="${#all_releases[@]}"
    if [ "$count" -le "$RELEASES_TO_KEEP" ]; then
        step_ok "Nothing to prune ($count release(s), keeping $RELEASES_TO_KEEP)"
        return 0
    fi

    local to_remove=$((count - RELEASES_TO_KEEP))
    local removed=()
    local i dir
    for ((i = 0; i < to_remove; i++)); do
        dir="${releases_dir}/${all_releases[$i]}"
        if [ "$(readlink -f "$dir" 2>/dev/null || true)" = "$current_target" ]; then
            continue
        fi
        rm -rf "$dir" 2>/dev/null && removed+=("${all_releases[$i]}")
    done
    step_ok "Pruned ${#removed[@]} old release(s): ${removed[*]:-none}"
    return 0
}

run_atomic_deploy() {
    _require_config
    step_verify_environment
    step_build
    step_locate_standalone
    step_assemble_release
    step_verify_release
    step_swap_current
    step_restart_pm2
    step_http_checks
    step_prune_releases || echo "WARN: release pruning had an issue (non-fatal, deploy already succeeded)"

    echo
    echo "======================= DEPLOY SUMMARY ======================="
    echo "GIT_SHA:             $GIT_SHA"
    echo "BUILD_TIME:          $BUILD_TIME"
    echo "BUILD_ID:            $BUILD_ID"
    echo "Release:             $RELEASE_DIR"
    echo "PM2 $PM2_NAME:       $PM2_STATUS"
    echo "PM2 $PM2_OTHER (untouched): $PM2_OTHER_AFTER"
    echo "HTTP  /            : $HTTP_CODE"
    echo "HTTP  static asset : $ASSET_CODE (${ASSET_SIZE} bytes)"
    echo "                      $ASSET_URL"
    echo "----------------------------------------------------------------"
    local r
    for r in "${STEP_RESULTS[@]}"; do
        echo "$r"
    done
    echo "================================================================"
    echo "DEPLOY SUCCEEDED ($PM2_NAME)."
}
