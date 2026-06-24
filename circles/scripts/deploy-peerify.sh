#!/usr/bin/env bash
set -euo pipefail

cd ~/apps/peerify-app/circles

echo "Loading production environment..."
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

export NODE_ENV=production
export GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Cleaning old build..."
rm -rf .next

echo "Installing dependencies..."
npm install --legacy-peer-deps

echo "Building Peerify..."
npm run build

echo "Copying standalone assets..."
mkdir -p .next/standalone/.next

rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static

rm -rf .next/standalone/public
cp -r public .next/standalone/public

echo "Restarting PM2..."
pm2 restart peerify --update-env

echo "Peerify deployed."
echo "Version: ${GIT_SHA} @ ${BUILD_TIME}"
