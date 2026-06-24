# CLAUDE_CONTEXT.md
# Peerify — Persistent AI Context

This file is the stable foundation for AI-assisted development sessions.

Peerify is a community-powered music platform for discovering, supporting and hosting real musicians.

It is built from the Circles/Kamooni codebase, but now lives in its own repository so Peerify work is separated from Kamooni.

Live app:

    https://peerify.one

GitHub:

    https://github.com/Social-Systems-Lab/peerify

## Current repository

Canonical repo:

    Social-Systems-Lab/peerify

Server repo path:

    /home/tim/apps/peerify-app

Application path:

    /home/tim/apps/peerify-app/circles

The application still lives inside the nested circles/ directory. Do not flatten or rename this casually.

Old source branch:

    Social-Systems-Lab/circles product/peerify

The old branch is retained temporarily for rollback/history only. Do not continue Peerify development there.

## What Peerify is

Peerify is a not-for-profit, community-driven music platform focused on:

- artist discovery
- direct artist/fan relationships
- fair creator economics
- map-based discovery
- live and local music
- hosts, venues and house concerts
- human-created music rather than AI-generated content

Peerify is not intended to be another streaming platform. It is a toolbox and ecosystem for artists, fans and hosts.

## Tech stack

- Next.js 15 App Router
- TypeScript
- MongoDB
- MinIO
- Qdrant
- PM2 production runtime
- nginx reverse proxy
- Postmark email integration where configured
- Stripe integration where configured
- Tailwind CSS / Radix UI
- Mapbox GL

Version at time of migration:

    0.8.15

## Production environment

Server:

    tim@65.21.91.96

Public URL:

    https://peerify.one

App path:

    /home/tim/apps/peerify-app/circles

PM2 process:

    peerify

Deploy:

    cd ~/apps/peerify-app/circles
    ./scripts/deploy-peerify.sh

Verify:

    curl -fsSL https://peerify.one/api/version
    curl -I https://peerify.one/
    pm2 describe peerify

Expected PM2 script path:

    /home/tim/apps/peerify-app/circles/.next/standalone/server.js

## Important runtime notes

.env.local is required on the production server and is intentionally ignored by Git.

Required production values include:

    NEXT_PUBLIC_APP_URL=https://peerify.one
    CIRCLES_COOKIE_SECURE=true
    CIRCLES_HOST=127.0.0.1
    CIRCLES_PORT=3000

Do not put NODE_ENV=development in .env.local.

## Naming caution

Many inherited internals still use circles or CIRCLES_* names.

Do not mass-replace these names. Some are tied to database records, routes, auth/session logic, storage URLs, or migration history.

Safe cleanup areas:

- docs
- public branding
- Peerify-specific copy
- deploy paths
- package identity

Risky cleanup areas:

- database collection names
- auth/session variable names
- CIRCLES_URL/CIRCLES_* runtime usage
- route names used by existing data
- Docker volumes and storage buckets

## AI workflow rules

The human operator mainly copy-pastes commands.

Instructions should be:

- exact
- copy-paste safe
- one step at a time
- explicit about the working directory

Prefer automated patches using Python scripts over manual editing.

Before changing code, inspect logs, Git status, environment assumptions and runtime paths.

## Development notes

Dependencies currently require:

    npm install --legacy-peer-deps --include=dev

The project uses React 19 RC packages, so plain npm install may fail with peer dependency resolution errors.

## Session workflow

At the start of a session:

1. Confirm the repo path.
2. Check git status.
3. Confirm whether the task is docs, code, deploy or production debugging.
4. Prefer small, reversible changes.
5. Verify with build, PM2 status or browser checks as appropriate.
