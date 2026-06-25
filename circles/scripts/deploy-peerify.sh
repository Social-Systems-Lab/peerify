#!/usr/bin/env bash
set -euo pipefail

cd ~/apps/peerify-app/circles

echo "Loading production environment..."
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

export GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Installing dependencies..."
npm install --legacy-peer-deps --include=dev

export NODE_ENV=production

echo "Cleaning old build..."
rm -rf .next

echo "Building Peerify..."
npm run build

echo "Copying standalone assets..."
mkdir -p .next/standalone/.next

rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static

rm -rf .next/standalone/public
cp -r public .next/standalone/public

echo "Restarting PM2..."
STANDALONE_ROOT=".next/standalone/apps/peerify-app/circles"
STANDALONE_SERVER="${STANDALONE_ROOT}/server.js"

if [ ! -f "${STANDALONE_SERVER}" ]; then
  echo "Could not find standalone server at ${STANDALONE_SERVER}"
  exit 1
fi

pm2 delete peerify >/dev/null 2>&1 || true
PORT=3000 NODE_ENV=production pm2 start "$(pwd)/${STANDALONE_SERVER}" \
  --name peerify \
  --cwd "$(pwd)/${STANDALONE_ROOT}" \
  --update-env
pm2 save

echo "Peerify deployed."
echo "Version: ${GIT_SHA} @ ${BUILD_TIME}"
