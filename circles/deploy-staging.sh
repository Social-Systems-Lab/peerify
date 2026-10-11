#!/usr/bin/env bash
#
# Deploy the `staging` branch to the peerify-staging PM2 process.
#
# Thin config wrapper around scripts/deploy-common.sh's atomic-release
# deploy flow (build into a fresh releases/<id>/ dir, verify it in
# isolation, atomically swap the 'current' symlink, only then restart PM2).
# See scripts/deploy-common.sh for the full design rationale — in short,
# this replaces the old "wipe the live standalone dir's static assets in
# place and hope nothing interrupts the copy" approach that caused the
# 2026-08-02 staging incident and the 2026-08-17 prod incident.
#
# The config depends on the box (hostname): the old shared box `peerify`,
# where prod runs next to staging, or the Cleura staging server, which runs
# only staging. Any other hostname is refused.
#
# On the shared box, never touches the `peerify` (prod) PM2 process except
# to confirm, before and after, that it was not disturbed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/deploy-common.sh"

EXPECTED_BRANCH="staging"
EXPECTED_PORT="3001"
PM2_NAME="peerify-staging"

case "$(hostname)" in
    peerify)
        # Old shared box (prod + staging), until the Cleura cutover.
        EXPECTED_HOST="peerify"
        PROJECT_DIR="/home/tim/apps/peerify-staging/circles/circles"
        ENV_FILE="/home/tim/apps/peerify-staging/circles/.env.local"
        NESTED_APP_PATH="."
        PM2_OTHER="peerify"
        RUN_BUN_INSTALL="false"
        ;;
    peerify-staging)
        # Cleura staging server: staging only, APP_DIR and env outside the checkout.
        EXPECTED_HOST="peerify-staging"
        PROJECT_DIR="/srv/peerify/app/circles"
        ENV_FILE="/srv/peerify/env/app.env"
        NESTED_APP_PATH="."
        PM2_OTHER=""
        RUN_BUN_INSTALL="true"
        ;;
    *)
        fail "Unknown host '$(hostname)': no staging deploy config for it."
        ;;
esac

if [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    fail "Running from '$SCRIPT_DIR', expected '$PROJECT_DIR'."
fi

run_atomic_deploy
