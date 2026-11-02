# Circles Repository Guide

## Build/Lint/Test Commands
- Development: `bun run dev` or `bun run dev:turbo` 
- Build: `bun run build`
- Start: `bun run start`
- Lint: `bun run lint`

## Development Environment
- Nothing runs from the working copy: there is no local dev server. Check work with the commands below.
- Install: `bun install --frozen-lockfile` (the same as the deploy script; don't use npm, it would add a `package-lock.json`)
- Type check: `bunx tsc --noEmit -p tsconfig.json`
- Tests: bun test, one file at a time: `IS_BUILD=true bun test <file>` (running them all in one process gives false failures from `mock.module` leaks). Skip tests that need a database.
- Build: `bun run build` (sets `IS_BUILD=true`, so no env file is needed). A build made in the working copy is for checking only, never for deploying.

## Package Management
- Uses Bun as package manager: `bun install --frozen-lockfile` for dependencies

## Code Style
- **Formatting**: Tab width = 4, Print width = 120 (see .prettierrc)
- **Types**: Use TypeScript with strict mode enabled. Define types with zod when possible
- **Imports**: Group imports by source (React/Next, local components, models, lib)
- **Path Aliases**: Use `@/` for src/, `@app/` for src/app/, `@images/` for public/images/
- **Component Structure**: React FC with explicit typing, functional components with hooks
- **State Management**: Use jotai for global state with atoms
- **Error Handling**: Log errors to console, display user-friendly messages via toast
- **File Naming**: Kebab-case for files, PascalCase for components, camelCase for variables
- **Form Handling**: Use react-hook-form with zod validation schemas
- **Components**: Prefer small, reusable components with clear props interfaces

## Project Structure
- Components are organized by functionality in `/src/components/`
- Pages and routes in `/src/app/` (Next.js App Router)
- Models and type definitions in `/src/models/`
- Utilities and helpers in `/src/lib/`

## Where this runs (since 2026-11-02)

- This box is the Cleura staging server (hostname `peerify-staging`). It runs staging only. Prod runs on its own Cleura server (`peerify-prod`).
- Working copy: `~/work/peerify`, branch `staging`; the app is in `circles/`. Push to `staging` only, never to `main`. The GitHub deploy key works only for this repo.
- The live staging app runs from `/srv/peerify/app` as the `peerify` user. Never edit anything under `/srv/peerify`, and never read `/srv/peerify/env/app.env` or other secrets. Tim deploys staging himself: never run `deploy-staging.sh` (on this hostname it targets `/srv`).
- The MongoDB on this box is staging's live database. Never point tests or scripts at it, and never run mongosh or any database command without asking Tim first, even in auto mode.
- Reports go in `~/cc-reports/outbox/`. Tim fetches them with `scp peerify-staging:~/cc-reports/outbox/<file> ~/Downloads/`.
- The old Hetzner box (`peerify-old`, 65.21.91.96) is unreachable and being retired. Don't try to connect to it. Older SESSION_LOG entries describe it (`~/apps/...` paths, PM2 on one box).

## Deploy Safety — Prod Confirmation Required

Before any action — in this or any future session — that deploys to, pushes to, or otherwise touches **prod** (`git push origin main`, running `scripts/deploy-peerify.sh`, restarting the `peerify` pm2 process, or writing to the prod Mongo db `circles`), explicitly state that the target is prod and wait for explicit go-ahead before proceeding. This applies regardless of what terminal/session the instruction came from, and even if an earlier message in the same conversation seems to have already authorized it — do not treat a prior "deploy to prod" as standing authorization for a later one. (Rule added 2026-08-21 per Tim's instruction.)
