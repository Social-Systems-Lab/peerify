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
# Never touches the `peerify` (prod) PM2 process except to confirm, before
# and after, that it was not disturbed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_DIR="/home/tim/apps/peerify-staging/circles/circles"
ENV_FILE="/home/tim/apps/peerify-staging/circles/.env.local"
EXPECTED_HOST="peerify"
EXPECTED_BRANCH="staging"
EXPECTED_PORT="3001"
NESTED_APP_PATH="apps/peerify-staging/circles/circles"
PM2_NAME="peerify-staging"
PM2_OTHER="peerify"
RUN_BUN_INSTALL="false"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/deploy-common.sh"

if [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    fail "Running from '$SCRIPT_DIR', expected '$PROJECT_DIR'."
fi

run_atomic_deploy
