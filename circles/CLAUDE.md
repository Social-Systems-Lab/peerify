# Circles Repository Guide

## Build/Lint/Test Commands
- Development: `bun run dev` or `bun run dev:turbo` 
- Build: `bun run build`
- Start: `bun run start`
- Lint: `bun run lint`

## Development Environment
- Assume a local version is already running with hot reload enabled
- Local server: http://localhost:3000
- You don't need to start the development server

## Package Management
- Uses Bun as package manager: `bun install` for dependencies

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

## Deploy Safety — Prod Confirmation Required

This repo (`peerify-app`, branch `main`) IS prod. Before any action — in this or any future session — that deploys to, pushes to, or otherwise touches **prod** (`git push origin main`, running `scripts/deploy-peerify.sh`, restarting the `peerify` pm2 process, or writing to the prod Mongo db `circles`), explicitly state that the target is prod and wait for explicit go-ahead before proceeding. This applies regardless of what terminal/session the instruction came from, and even if an earlier message in the same conversation seems to have already authorized it — do not treat a prior "deploy to prod" as standing authorization for a later one. (Rule added 2026-08-21 per Tim's instruction.)