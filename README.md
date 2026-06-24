# Peerify

Peerify is a community-powered music platform for discovering, supporting and hosting real musicians.

Peerify is built from the Circles/Kamooni codebase, but now lives in its own repository so future Peerify work is separated from Kamooni.

Live app: https://peerify.one

## Repository status

Canonical repo:

    Social-Systems-Lab/peerify

Old source branch:

    Social-Systems-Lab/circles product/peerify

The old product/peerify branch should now be treated as frozen rollback/history only.

## What this repo contains

- Next.js / TypeScript application
- MongoDB-backed app data
- Mongo-native chat and notifications
- MinIO-based object storage
- Qdrant for vector / semantic features
- PM2-based production deployment
- Docker files inherited from the original Circles codebase

## Repository layout

The application currently lives inside the nested circles/ directory:

    peerify/
      README.md
      docs/
      circles/
        package.json
        src/
        public/
        scripts/

This nested structure is inherited from the original codebase. Do not flatten or rename it casually.

## Production deployment

Production runs from:

    /home/tim/apps/peerify-app/circles

PM2 process:

    peerify

Deploy command:

    cd ~/apps/peerify-app/circles
    ./scripts/deploy-peerify.sh

The deploy script loads .env.local, installs dependencies, builds the standalone Next.js app, copies static assets, restarts PM2, and exposes build metadata through /api/version.

## Important naming note

Some internal code, routes, database concepts, documentation and environment variable names still use circles or CIRCLES_*.

Do not mass-replace these names blindly.

Safe to change gradually:

- README and developer docs
- Peerify branding
- deployment paths
- public app metadata
- package identity
- Peerify-specific feature copy

Do not change blindly:

- database collection names
- auth/session environment variables
- migration history
- route names used by existing data
- Docker volume names
- storage bucket assumptions

## Useful commands

Check app status:

    pm2 status
    pm2 describe peerify
    curl -fsSL https://peerify.one/api/version
    curl -I https://peerify.one/

Deploy:

    cd ~/apps/peerify-app/circles
    ./scripts/deploy-peerify.sh

Check repo state:

    cd ~/apps/peerify-app
    git status --short
    git log --oneline --decorate -5
    git remote -v

## Development notes

Dependencies currently require:

    npm install --legacy-peer-deps --include=dev

The project uses React 19 RC packages, so plain npm install may fail with peer dependency resolution errors.

## Next cleanup priorities

- Update developer docs that still describe Kamooni as the product
- Audit deployment docs for old paths such as ~/apps/peerify/circles
- Decide which Docker files are still relevant to Peerify production
- Keep circles-origin as fetch-only while cherry-picking shared fixes remains useful
- Protect main on GitHub
