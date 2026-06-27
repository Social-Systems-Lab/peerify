# Peerify — System Architecture

*Technical architecture of the Peerify platform. For operational procedures (deploy, debug, common tasks) see `OPERATIONS.md`. For product vision and design see `PEERIFY_CONTEXT.md`. Last verified: 2026-06-27.*

> This file replaces an earlier `ARCHITECTURE.md` that described **Kamooni** (wrong server, `deploykamooni`, Docker, `/root/circles/circles`). None of that applied to Peerify.

---

## 1. What Peerify is built on

Peerify is a Next.js application built on the **Circles** codebase — the same foundation as its sibling project Kamooni. Peerify and Kamooni are separate deployments on separate servers, sharing Circles primitives (accounts, circles, events, members, feeds, messages, reviews, settings) but with their own products layered on top.

Peerify was migrated (~2026-06-25) from a branch on the shared `Social-Systems-Lab/circles` repo into its own standalone `Social-Systems-Lab/peerify` repo.

- **Framework:** Next.js (App Router), built as a **standalone** output.
- **Language:** TypeScript.
- **Build tool:** `bun`.
- **Runtime:** bare Node.js (v22) running the standalone `server.js`, managed by **PM2**. Not containerized in production.
- **Datastore:** MongoDB (single instance, local).
- **Object storage:** MinIO (S3-compatible, single instance, local).
- **Email:** Postmark.
- **Maps:** Mapbox.
- **Human verification:** ALTCHA (self-hosted, open-source).
- **Payments (present, not in critical path for current milestone):** Stripe.

---

## 2. Runtime topology

```
                         Internet
                            │
                    ┌───────┴────────┐
                    │  system nginx  │  (host-level, TLS via Let's Encrypt/Certbot)
                    └───┬────────┬───┘
        peerify.one ────┘        └──── staging.peerify.one
              │                              │
       127.0.0.1:3000                 127.0.0.1:3001
       PM2: peerify                   PM2: peerify-staging
       (Next.js standalone)           (Next.js standalone)
              │                              │
              ├──────────────┬──────────────┤
              ▼              ▼               ▼
        MongoDB         MinIO          (shared host services,
     127.0.0.1:27017  127.0.0.1:9000   logically separated by
        db: circles     bucket:          db name / bucket name)
        (prod)          circles (prod)
        db: peerify_    bucket:
        staging         circles-staging
```

Both app instances run on the same physical server (`65.21.91.96`). nginx routes by hostname to the correct port. The two instances are isolated at the data layer by **database name** (Mongo) and **bucket name** (MinIO), not by separate database/storage servers.

---

## 3. Data layer

### MongoDB
- Connection string in `MONGODB_URI`. **The database name is derived from the URI path** (`new URL(uri).pathname` with a `circles` fallback) — see `src/lib/data/db.ts`. This was fixed on 2026-06-27; previously the name was hardcoded to `circles`, which broke environment isolation.
- Production database: `circles`. Staging database: `peerify_staging`.
- Core collection: `circles` (holds users/accounts, circles, and related documents; site-wide admin is the `isAdmin` boolean on user docs).

### MinIO / object storage
- Client configured from `MINIO_HOST` / `MINIO_PORT` / `MINIO_ROOT_*`. **Bucket name comes from `MINIO_BUCKET`** (fallback `circles`) — see `src/lib/data/storage.ts`. Also fixed 2026-06-27 (was hardcoded).
- Production bucket: `circles`. Staging bucket: `circles-staging`.
- Uploads (profile images, hero images, audio derivatives) are written by `storage.ts` (`saveFile`, `deleteFile`, `ensureBucketExists`) and served back through app routes `src/app/storage/[...path]/route.ts` and `src/app/uploads/[...path]/route.ts`, which proxy from MinIO using signed/app-level access (MinIO is not directly browser-reachable).

### User key material
- Per-user encryption keys live on disk under `APP_DIR` (read in `src/lib/auth/auth.ts`), *not* in MongoDB. Each environment has its own `APP_DIR`, so accounts/keys do not cross between prod and staging. This is why an account that exists in prod cannot log in on staging without signing up there.

---

## 4. The audio pipeline

- Track model + private MinIO storage.
- On upload: synchronous ffmpeg conversion to a single ~192kbps MP3 derivative (`ffmpeg-static`, installed via bun at build time).
- Playback: native `<audio>` element fed by a signed, expiring app-level stream route with HTTP range support (not MinIO presigned URLs).
- Upload is gated (admins/moderators/verified users); public viewing/playback is allowed for unauthenticated visitors (the "discover → listen" path).
- Deferred to later product phases: multi-bitrate, DRM, async/queued conversion, real payments.

---

## 5. Environments

| | Production | Staging |
|---|---|---|
| Branch | `main` | `staging` |
| App dir (git worktree) | `/home/tim/apps/peerify-app/circles` | `/home/tim/apps/peerify-staging/circles/circles` |
| Process | PM2 `peerify` :3000 | PM2 `peerify-staging` :3001 |
| Mongo DB | `circles` | `peerify_staging` |
| MinIO bucket | `circles` | `circles-staging` |
| Env loading | PM2 inline (`--update-env`) | Node `--env-file` |

Deploy flow: feature → `staging` → test on staging.peerify.one → `staging` merged to `main` → production. Operational detail (including the required post-build static-asset copy step) lives in `OPERATIONS.md`.

---

## 6. Known architectural debt

- **The "circles" hardcode lineage.** Because Circles named everything `circles`, several modules hardcoded that literal instead of reading env vars, silently defeating environment isolation. Two were fixed (db, storage); the codebase should be swept for others.
- **Standalone static assets.** Next.js standalone output omits `.next/static` and `public`; they must be copied next to `server.js` per deploy. Should be folded into a deploy script.
- **Legacy `APP_DIR` path.** Production's `APP_DIR` still points at a pre-rename directory that holds the live keys; migrating it is a careful future task, not a quick fix.
- **Inherited Kamooni docs.** Some repo docs still carry Kamooni identity/content; being corrected incrementally.
