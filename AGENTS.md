# AGENTS.md — AI Agent Instructions for Peerify

This repository contains Peerify, a community-powered music platform for discovering, supporting and hosting real musicians.

Peerify was split out from Social-Systems-Lab/circles and now lives in its own repository:

    Social-Systems-Lab/peerify

Live app:

    https://peerify.one

The human operator is not an experienced developer and can reliably only copy and paste commands.

Agents must operate with extreme clarity, minimal manual editing, and safe production practices.

## Core principle

Prefer investigation and automated patches over asking the human to edit files manually.

Priority order:

1. Investigation
2. Patch
3. Automated edit using a script
4. Manual edit by human as last resort

## Interaction rules

When giving instructions:

- Provide exact commands only.
- Commands must be copy-paste safe.
- Specify where the command must run.
- Use one action at a time unless explicitly asked otherwise.

Workflow:

1. Human runs command.
2. Human pastes output.
3. Agent analyzes output.
4. Agent provides the next step.

## Production environment

Server:

    tim@65.21.91.96

Application directory:

    /home/tim/apps/peerify-app/circles

Public URL:

    https://peerify.one

PM2 process:

    peerify

## Deployment

Preferred deployment command on the Peerify server:

    cd ~/apps/peerify-app/circles
    ./scripts/deploy-peerify.sh

The deploy script loads .env.local, installs dependencies with legacy peer dependency handling, builds the standalone Next.js app, copies static assets, restarts PM2, and exposes build metadata through /api/version.

## Deployment verification

Always verify deployment with:

    curl -fsSL https://peerify.one/api/version
    curl -I https://peerify.one/

The returned gitSha should match the deployed commit.

Also verify PM2 points at the new repo path:

    pm2 describe peerify

Expected script path:

    /home/tim/apps/peerify-app/circles/.next/standalone/server.js

## Repository safety

The old Peerify branch in Social-Systems-Lab/circles is retained for rollback/history only:

    product/peerify

Do not continue Peerify development in Social-Systems-Lab/circles.

The old remote may exist locally as circles-origin and should remain fetch-only:

    circles-origin DISABLED (push)

## Naming caution

Some internal code, routes, database concepts, docs, and environment variables still use circles or CIRCLES_*.

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

## Development notes

Dependencies currently require:

    npm install --legacy-peer-deps --include=dev

The project uses React 19 RC packages, so plain npm install may fail with peer dependency resolution errors.

## Coding philosophy

Prefer:

- small patches
- minimal surface changes
- explicit code
- predictable behavior

Avoid:

- large refactors
- unnecessary abstractions
- renaming files unless necessary
