#!/usr/bin/env bash
#
# Deploy the `main` branch to the peerify (production) PM2 process.
#
# Thin config wrapper around scripts/deploy-common.sh's atomic-release
# deploy flow (build into a fresh releases/<id>/ dir, verify it in
# isolation, atomically swap the 'current' symlink, only then restart PM2).
# See scripts/deploy-common.sh for the full design rationale — in short,
# this replaces the old "wipe the live standalone dir's static assets in
# place (and, here, also `rm -rf .next` — which deleted the live serving
# directory entirely, since it was nested inside `.next`) and hope nothing
# interrupts the copy" approach that caused the 2026-08-17 prod incident
# (and the 2026-08-02 staging incident before it).
#
# Uses `pm2 restart` (never delete+start) so there is no window where
# nothing is listening on the prod port — that only requires --cwd to
# already point at PROJECT_DIR-adjacent 'current', which the one-time
# migration (see SESSION_LOG.md) establishes before this script is used.
#
# Never touches the `peerify-staging` PM2 process except to confirm,
# before and after, that it was not disturbed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT_DIR="/home/tim/apps/peerify-app/circles"
ENV_FILE="/home/tim/apps/peerify-app/circles/.env.local"
EXPECTED_HOST="peerify"
EXPECTED_BRANCH="main"
EXPECTED_PORT="3000"
NESTED_APP_PATH="apps/peerify-app/circles"
PM2_NAME="peerify"
PM2_OTHER="peerify-staging"
RUN_BUN_INSTALL="true"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/deploy-common.sh"

if [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    fail "Running from '$SCRIPT_DIR', expected '$PROJECT_DIR'."
fi

run_atomic_deploy
