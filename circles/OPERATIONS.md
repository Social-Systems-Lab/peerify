# Peerify — Operations Runbook

**Purpose:** The operational source of truth for running, deploying, and debugging Peerify. This is the *how-to*, separate from the product vision (`PEERIFY_CONTEXT.md`) and the chronological record (`SESSION_LOG.md`). If you are an AI session or a human picking up this project, **read this first** before touching the server.

*Last verified: 2026-06-27.*

---

## 0. Golden rules (read before doing anything)

1. **Run Claude Code ON the server, not on the Mac.** SSH into the server in your own terminal first, then start `claude` there. Claude Code then operates locally on the machine. Do NOT let a Mac-side session SSH into production to run commands remotely — that is a looser, riskier model. Authentication is handled by your own SSH session before Claude Code starts. Never paste server passwords/credentials into a prompt.
2. **Check which machine you are on before every action.** The shell prompt tells you: `tim@peerify` = the Peerify server (correct). `timmidnightmac@...` = your Mac (wrong for server work). `ubuntu@kamooniorg` / `91.123.202.241` = the **Kamooni** server (a *different machine* — never run Peerify commands here). With multiple terminal tabs open, wrong-server mistakes are the single biggest risk.
3. **Production changes get reviewed before they run.** Show the diff/command, confirm, then execute. The only routine production touch is additive. Anything that restarts/rebuilds prod is deliberate and scheduled.
4. **Never delete from the production MinIO bucket with wildcards or `--recursive`.** Always use exact object paths, one at a time, and confirm the object count drops by exactly the expected number. Prefer *move* (copy-verify-then-remove) over delete when in doubt.
5. **Test staging in an incognito/private browser window.** A normal window caches production state and will mislead you into thinking staging shows prod data.
6. **Staging test before merging to main, always.** Especially for the audio pipeline. No exceptions.

---

## 1. Live architecture (as of 2026-06-27)

### Servers
- **Peerify server:** `tim@65.21.91.96` (Hetzner). Hostname `peerify`.
- **Kamooni server:** `ubuntu@91.123.202.241` (hostname `kamooniorg`) — *separate machine, separate project.* Do not confuse.

### Production (peerify.one)
- **Public URL:** `https://peerify.one` (HTTPS, live).
- **App directory:** `/home/tim/apps/peerify-app/circles` — git worktree on branch `main`.
- **App entry (built):** Next.js standalone, run by **PM2** (process name `peerify`) as a bare `node server.js`. **Not Docker.** (A Dockerfile exists in the repo but it targets Kamooni, not Peerify.)
- **Port:** `3000` (bound to `127.0.0.1:3000`).
- **Node:** v22.x. **Build tool:** `bun` (installed user-level at `~/.bun`).
- **Env:** loaded *inline into the PM2 process* at start time (no `--env-file`). The deploy script sources `.env.local` then `pm2 start ... --update-env`. Editing `.env.local` has **no effect until** the process is restarted with `--update-env`.
- **Reverse proxy / TLS:** system **nginx** (host-level), config at `/etc/nginx/sites-available/peerify.one` (symlinked into `sites-enabled`). TLS via Let's Encrypt / Certbot, auto-renewing.

### Staging (staging.peerify.one)
- **Public URL:** `https://staging.peerify.one` (HTTPS, live).
- **App directory:** `/home/tim/apps/peerify-staging/circles/circles` — **git worktree** on branch `staging`. (Note the doubled `circles/circles`: the worktree root is `peerify-staging/circles`, the app lives one level deeper in `circles/`.)
- **PM2 process:** `peerify-staging`, port **3001**.
- **Env:** staging loads its env via Node's `--env-file` pointed at `/home/tim/apps/peerify-staging/circles/.env.local` (mode 600). Key staging-specific values: `PORT=3001`, `CIRCLES_PORT=3001`, `MONGODB_URI=.../peerify_staging`, `MINIO_BUCKET=circles-staging`, `APP_DIR=/home/tim/apps/peerify-staging-data`, fresh JWT/ALTCHA secrets, `CIRCLES_COOKIE_SECURE=true`.
- **nginx:** `/etc/nginx/sites-available/staging.peerify.one` → `127.0.0.1:3001`, own Let's Encrypt cert. Mirrors the prod block; does NOT carry a duplicate `ipv6only=on` (nginx allows it once per port).

### Shared infrastructure (one instance each, on the Peerify server)
- **MongoDB:** `mongodb://127.0.0.1:27017`, no auth (local). **Database name is now derived from `MONGODB_URI`** (see §3). Prod DB = `circles`. Staging DB = `peerify_staging`.
- **MinIO:** `127.0.0.1:9000`, mc alias `peerify-local`. Prod bucket = `circles`. Staging bucket = `circles-staging`.

### Isolation summary
Staging is isolated from prod across **every** layer: separate worktree/branch, separate database (`peerify_staging`), separate bucket (`circles-staging`), separate port (3001), separate user-key folder (`APP_DIR`), separate secrets. Production and staging share the *MongoDB server* and the *MinIO server*, but not the same database or bucket within them.

---

## 2. Deploy flow

```
feature branch  →  merge to `staging`  →  deploy to staging  →  test on staging.peerify.one (incognito)
             →  merge `staging` to `main`  →  deploy to production
```

### Deploy to STAGING (safe, do freely)
From the staging worktree (`/home/tim/apps/peerify-staging/circles/circles`), ideally inside a `tmux` session named `build` so a dropped SSH connection can't kill a long build:

```bash
cd /home/tim/apps/peerify-staging/circles/circles
bun install            # only if dependencies changed
bun run build
# ⚠️ REQUIRED after EVERY build — the standalone output does NOT include static assets:
cp -r .next/static  .next/standalone/apps/peerify-staging/circles/circles/.next/static
cp -r public        .next/standalone/apps/peerify-staging/circles/circles/public
pm2 restart peerify-staging
pm2 list               # confirm online; confirm prod `peerify` untouched
```

Then verify in **incognito** at `https://staging.peerify.one`.

### Deploy to PRODUCTION (deliberate — involves brief downtime)
Prod runs in PM2 **fork mode**, so a restart is a hard ~2–5s kill-and-respawn (connections refused during that window). Pick a low-traffic moment. The same static-copy step applies, into prod's standalone path. Reload PM2 with `--update-env` if env changed, then `pm2 save`.

> **There is not yet a single robust deploy script that includes the static-copy step.** See Known Issues §5. Until there is, the static copy must be run manually on every deploy or CSS/images break.

---

## 3. The "circles" hardcode pattern (IMPORTANT — recurring bug class)

The codebase was originally written for Kamooni, where the database and bucket were both literally named `circles`. Several places **hardcoded `"circles"`** and ignored the corresponding env var. This caused staging to silently read/write **production's** data. Two instances were found and fixed on 2026-06-27:

- **`src/lib/data/db.ts`** — hardcoded `client.db("circles")`. Fixed to derive the DB name from the URI:
  `const dbName = new URL(MONGODB_URI).pathname.replace(/^\//,'') || 'circles';` then `client.db(dbName)` at both call sites.
- **`src/lib/data/storage.ts`** — hardcoded `const bucketName = "circles"`. Fixed to `const bucketName = process.env.MINIO_BUCKET || "circles";`

**⚠️ There may be OTHER hardcoded `"circles"` references** (config, other storage/data paths) that could cause the same staging↔prod bleed. A future task is to grep the codebase for `"circles"` and audit every hit. Until that sweep is done, treat any new staging/prod data weirdness as a possible hardcode leak.

**Consequence to remember:** because of this bug, prod's env URI historically said `/peerify` but the code used `circles` regardless. Prod's `.env.local` has been corrected to `.../circles` so it stays honest once the fix ships. Prod's *real* database has always been `circles` — that did not change.

---

## 4. Common operations

### Make a user admin on staging
Admin is a single `isAdmin: boolean` on the user document in the `circles` collection (this is site-wide admin; the per-circle `role` enum is separate). Staging's DB is `peerify_staging`. The user must have **signed up on staging first** (staging has its own DB and its own key folder, so prod accounts don't exist there). Then:
```js
db.getSiblingDB('peerify_staging').circles.updateOne({email:'<email>'}, {$set:{isAdmin:true}})
```
Verify before (doc exists, isAdmin absent) and after (isAdmin true). Confirm prod's `circles` DB was not touched.

### Add a new subdomain (e.g. a future environment)
1. DNS: A record → `65.21.91.96`.
2. `sudo certbot certonly --nginx -d <subdomain>` (NOT `--nginx` alone — `certonly` fetches the cert without auto-editing nginx).
3. Write an nginx server block in `sites-available` mirroring the prod block (proxy headers, `client_max_body_size 50m`, websocket upgrade, the right port). Omit a second `ipv6only=on`.
4. Symlink into `sites-enabled`, `sudo nginx -t` (MUST say "test is successful" before reloading), then `sudo systemctl reload nginx`.

### Clean stray files from a bucket
Use copy-verify-then-remove with exact paths only. Record object count before and after; it must change by exactly the expected number. Never wildcard/recursive against a whole bucket.

---

## 5. Known issues / outstanding tasks

- [ ] **Prod not yet on the isolation fixes.** `db.ts` + `storage.ts` fixes are committed on `staging` and proven there, but `main`/prod has not been deployed yet. Requires merge to main + prod rebuild + the one deliberate restart.
- [ ] **No deploy script with the static-copy step.** Every deploy must currently run the `cp -r .next/static` + `cp -r public` manually or assets break. Should be scripted (a `scripts/deploy-staging.sh` / `deploy-peerify.sh` that builds, copies static, restarts).
- [ ] **`pm2 save` for staging.** Confirm `peerify-staging` is in the saved PM2 list so it survives a server reboot. (Check how prod persistence is set up and match it.)
- [ ] **Audit for other `"circles"` hardcodes** (see §3). Grep the codebase; fix any that ignore their env var.
- [ ] **Stale repo docs.** `ARCHITECTURE.md` is Kamooni content (wrong server/deploy/paths); `SESSION_LOG.md` header still says Kamooni; `CLAUDE.md`/`CLAUDE_CONTEXT.md` say `npm` (project uses `bun`) and contain a leftover "use Python scripts" instruction. These need correcting.
- [ ] **Leftover `console.log("DEBUG DB: ...")`** in `db.ts` — harmless (masks password) but should be removed in a tidy-up.
- [ ] **Product/UX question (not infra):** artist profile creation currently shares the personal-profile space; consider moving artist-profile setup to "Create" with a link from Settings, to separate personal identity from the outward-facing artist account.

---

## 6. Quick reference

| Thing | Production | Staging |
|---|---|---|
| URL | https://peerify.one | https://staging.peerify.one |
| App dir | /home/tim/apps/peerify-app/circles | /home/tim/apps/peerify-staging/circles/circles |
| Branch | main | staging |
| PM2 process | peerify | peerify-staging |
| Port | 3000 | 3001 |
| Mongo DB | circles | peerify_staging |
| MinIO bucket | circles | circles-staging |
| APP_DIR (user keys) | /home/tim/apps/peerify/circles/circles (legacy path, in use) | /home/tim/apps/peerify-staging-data |
| Env load | PM2 inline (`--update-env`) | `--env-file` → .env.local |

*Note: prod's `APP_DIR` points at a legacy path that predates the directory rename but still contains the live user-key data — do not "fix" it without migrating the keys.*
