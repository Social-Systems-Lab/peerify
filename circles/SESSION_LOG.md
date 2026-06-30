# Peerify — Session Log

Live at: https://peerify.one  ·  Staging: https://staging.peerify.one
(This log was migrated from the Kamooni/Circles repo during the 2026-06 split; entries before ~June 2026 describe Kamooni lineage and shared Circles work.)

## Current Status (2026-06-28)
- Production: https://peerify.one — live, HTTPS (nginx + Certbot), PM2 process `peerify` on :3000, branch `main` @ 116e9394.
- Staging:    https://staging.peerify.one — live, isolated, PM2 process `peerify-staging` on :3001.
- Audio pipeline: LIVE on prod (MP3 upload → ffmpeg derivative → signed streaming → play-only player). ffmpeg resolved via host /usr/bin/ffmpeg; prod .env.local sets FFMPEG_PATH explicitly.
- Build tool: bun. Runtime: Next.js standalone via PM2 (not Docker).
- See OPERATIONS.md for full architecture and deploy procedure.

---

## 2026-06-28 (cont. #2) — Ship audio pipeline to PROD: merge, lockfile fix, ffmpeg ENOENT fix

Headline: Merged `feature/audio-pipeline` into `main` and deployed the full audio feature to production. MP3 upload → ffmpeg derivative → publish → playback now working end-to-end on prod (bare-Node PM2). Two deploy-blocking issues surfaced and were fixed: a pre-existing lockfile inconsistency, and an ffmpeg path-resolution bug that only manifests under Next.js standalone bundling.

Pre-merge cleanup (on `feature/audio-pipeline`):
- Removed DEBUG console.logs from auth.ts (3 lines) and admin/page.tsx ([ADMIN DEBUG], logged owner email) — commit 83367467, pushed.
- Discarded a Kamooni CAPTCHA lockfile contamination (altcha/altcha-lib/hash-wasm + configVersion:0) that had appeared uncommitted in the staging worktree's bun.lock. NOTE: altcha is a LEGITIMATE Peerify dep on main (commit c57dcedf "Add ALTCHA verification to Peerify signup") — the contamination was only the stray worktree state, not the dep itself.

Merge (feature/audio-pipeline -> main):
- Done via a DETACHED throwaway worktree at /tmp/peerify-merge (main is checked out in the prod worktree, so neither staging nor prod was disturbed). --no-ff merge.
- Only conflict was SESSION_LOG.md (add/add) — resolved union-style (kept both sides).
- Verified all 5 merge hazards on the staged tree BEFORE committing: Tracks collection present in db.ts; no hardcoded db/bucket names; stripe apiVersion = 2026-03-25.dahlia (correct); no DEBUG logs reintroduced; FFMPEG_PATH only referenced as an OPTIONAL resolver override (not a hardcode). Merge commit 40576a43, pushed to origin/main.

Deploy blocker 1 — lockfile inconsistency (PRE-EXISTING on main):
- `bun install --frozen-lockfile` failed: main's package.json declared altcha deps but bun.lock never locked them. Independent of the audio merge — the audio deploy was just the first frozen-install to hit it.
- Fix: regenerated bun.lock to lock the altcha deps, committed bun.lock only (commit dfbf3188), pushed.

Deploy blocker 2 — ffmpeg ENOENT under standalone bundling:
- After deploy, MP3 upload failed: "Could not process the audio (ffmpeg)."
- Root cause: resolveFfmpegPath() in src/lib/audio/ffmpeg.ts trusted the ffmpeg-static path UNCONDITIONALLY. Under Next standalone bundling, require("ffmpeg-static") returns a traced path to a binary that was never copied into the bundle (.next/server/app/circles/[handle]/music/ffmpeg) -> spawn ENOENT. System ffmpeg at /usr/bin/ffmpeg (6.1.1) was available the whole time but never reached, because ffmpeg-static won resolution first (code order didn't match its own comment).
- Immediate fix (no rebuild, reversible): added FFMPEG_PATH=/usr/bin/ffmpeg to prod .env.local; restarted prod via pm2 delete + fresh start with --update-env. Upload worked immediately. KEPT as an intentional explicit override.
- Proper fix (code): guarded the ffmpeg-static branch with fs.existsSync(staticPath) so it's only used when the binary actually exists on disk; otherwise falls through to system "ffmpeg" on PATH. Commit 116e9394 (branch fix/ffmpeg-resolver, FF'd to main). Redeployed prod. Now belt-and-suspenders: env override + code fix.

Verification: prod online (HTTP 200), no new ffmpeg/ENOENT errors after restart, and a real browser upload + playback confirmed working on peerify.one.

State at end of session:
- Prod: main @ 116e9394, PM2 `peerify` :3000, audio LIVE. .env.local has FFMPEG_PATH=/usr/bin/ffmpeg (intentional). Backup of pre-change env at /tmp/.env.local.bak.
- Staging worktree: on branch fix/ffmpeg-resolver (was feature/audio-pipeline). .claude/settings.local.json modified but uncommitted (Claude Code settings — ignore).

CARRY-FORWARD:
1. Sync the ffmpeg resolver fix to STAGING — staging still runs the old resolver (relies on Docker-installed ffmpeg). Update staging to main-equivalent.
2. Remove deploy-genesis2.sh from the peerify repo (Kamooni/Docker script, lives in circles/ — never run on peerify box). Proper `git rm` + commit on main.
3. Rotate staging MINIO_ROOT_PASSWORD (exposed in a prior session).
4. Verify the stray `[DEBUG getOpenEventsForListAction]` log is gone — it appeared in old prod logs but is NOT in current source; confirm it's not reintroduced anywhere.
5. Decide handling for .claude/settings.local.json (commit, or add to .gitignore).
6. Now that the code fix exists, decide whether to keep the prod FFMPEG_PATH override (recommended: keep) or rely on the resolver alone.

---
## 2026-06-27 — Staging environment + two isolation-bug fixes

Headline: Stood up a fully isolated staging environment at staging.peerify.one,
then discovered and fixed two latent isolation bugs where staging was silently
sharing production's live data. Production left running untouched throughout;
prod deploy of the fixes is still pending (deliberate, scheduled separately).

What was built / changed:
- Staging environment on the same server as prod:
  - git worktree at /home/tim/apps/peerify-staging/circles on branch `staging`
  - PM2 process `peerify-staging` on port 3001, loading its own .env.local via --env-file
  - separate DB (peerify_staging), separate MinIO bucket (circles-staging),
    separate APP_DIR (peerify-staging-data) for user keys, fresh JWT/ALTCHA secrets
  - nginx server block for staging.peerify.one → :3001, Let's Encrypt cert
  - bun installed user-level on the host (prod build had been done elsewhere)
- Fixed Stripe apiVersion type error blocking the build
  (commit: align Stripe apiVersion with installed library type).
- ISOLATION BUG 1 — db.ts hardcoded client.db("circles") and ignored MONGODB_URI,
  so staging was reading/writing PRODUCTION's database. Fixed to derive the DB name
  from the URI. Verified: staging now uses peerify_staging (empty map = success),
  prod's circles DB unchanged. (commit on `staging`)
- ISOLATION BUG 2 — storage.ts hardcoded bucketName = "circles", so staging image
  UPLOADS were landing in PRODUCTION's bucket (reads correctly used circles-staging,
  causing broken images — "split-brain"). Fixed to read MINIO_BUCKET. Verified:
  fresh staging uploads now land in circles-staging and display. (commit on `staging`)
- Cleaned up 5 stray staging test files that had leaked into prod's `circles` bucket
  (moved to circles-staging via copy-verify-then-remove; prod bucket count 36 → 31,
  no other prod objects touched).
- Made tim@socialsystems.io an admin on staging (isAdmin:true in peerify_staging only;
  prod circles DB untouched).

Environment facts learned / confirmed:
- Prod is NOT Docker — bare Node via PM2, env loaded inline (--update-env on restart).
- The Next.js standalone build does NOT copy .next/static or public; they must be
  copied next to server.js after every build or CSS/images break.
- The "circles" hardcode is a recurring class of bug from the Kamooni lineage;
  more instances may exist — audit pending.

Still pending (carried forward):
- Deploy the db.ts + storage.ts fixes to prod (merge staging→main, rebuild, one
  deliberate ~2-5s PM2 restart at a low-traffic moment).
- Script the deploy (must include the static-copy step).
- pm2 save so peerify-staging survives reboot.
- Audit codebase for other hardcoded "circles".
- Doc hygiene: ARCHITECTURE.md / SESSION_LOG header / CLAUDE.md are stale (Kamooni/npm).
- Audio-pipeline feature is now testable on staging (was the original goal of staging).
- Product question: artist profile setup via Create vs Settings (separate from personal identity).

---

## 2026-06-27 (cont.) — Prod deploy of isolation fixes + Stripe regression caught

Headline: Deployed the db.ts + storage.ts isolation fixes to production
(merge staging→main, rebuild, restart). Surfaced and fixed a mislabeled Stripe
regression and an env-loading trap along the way. peerify.one verified live with
correct data layer (circles), CSS, and images. No active users; downtime moot.

Sequence:
- Pre-flight (read-only): captured rollback hash 0737b2b2; reviewed git log
  main..staging; confirmed prod .env.local reads /circles + circles.
- Fast-forward merged staging → main (commit 3713d215).
- First build FAILED: Stripe apiVersion type error. Investigation showed commit
  3f9c3472 ("align Stripe apiVersion...") actually did the REVERSE — it changed
  the value FROM the correct "2026-05-27.dahlia" TO the wrong "2026-03-25.dahlia".
  The installed stripe lib (^22.0.2) wants 2026-05-27.dahlia.
- Fixed line back to 2026-05-27.dahlia; committed to main (8a3c7d87). Rebuilt OK.
- Ran the required static-copy step into prod's standalone path
  (.next/standalone/apps/peerify-app/circles/{.next/static,public}). Verified
  no double-nesting; fresh build-id present.
- pm2 restart peerify --update-env — but logs showed MONGODB_URI = /peerify (!!).
  ROOT CAUSE: --update-env re-applies PM2's STORED env, not .env.local. PM2's
  dump still held a stale /peerify URI. With the new db.ts fix now HONORING the
  URI, prod briefly pointed at an (empty) "peerify" DB. No data lost — real
  circles DB untouched.
- FIX: `set -a; source .env.local; set +a` then pm2 restart --update-env.
  Verified pm2 env 0 → MONGODB_URI=/circles, MINIO_BUCKET=circles. Boot log
  confirms /circles. Site verified in incognito (content + CSS + images OK).
- pm2 save — dump now holds /circles only (no stale /peerify). Reboot-safe.

State after this session:
- Prod (main, 8a3c7d87): isolation fixes LIVE and reading env correctly.
- main is AHEAD of staging by the Stripe correction (8a3c7d87).

Carry-forward (do before next staging build):
- MERGE main → staging. staging still has the bad 2026-03-25 Stripe value and
  will fail to build until reconciled. This also brings these doc updates over.
- Deploy script MUST source .env.local before pm2 start (set -a; source; set +a),
  NOT rely on --update-env alone — or the /peerify trap recurs. Include the
  static-copy step too.
- .env.staging is sitting in the PROD worktree (harmless, but a foot-gun) — relocate/remove.
- Still pending from earlier: grep -rn '"circles"' src/ audit; remove DEBUG DB/AUTH
  console.logs in db.ts/auth.ts; stage-test feature/audio-pipeline.
## 2026-06-28 (cont.) — Audio polish sprint: play-only, upload limits, 3-track cap, ffmpeg durability

### Done
- Task 1 — Player PLAY-ONLY (commit 4ebe1929). audio-player.tsx: added
  controlsList="nodownload noplaybackrate" + onContextMenu preventDefault.
  Stream route already serves inline (no Content-Disposition: attachment) — no change
  needed. NOTE: this is a UI deterrent, NOT a security boundary; real download control
  comes later via the token/route layer.
- Task 2 — Upload limits MP3-only + 20MB (commit 0549b054).
  Server (actions.ts): ACCEPTED_EXTENSIONS -> .mp3 only; MAX_UPLOAD_BYTES 100MB->20MB;
  defense-in-depth file.type MIME check; updated messages.
  Client (track-upload-form.tsx): accept=".mp3,audio/mpeg"; helper "mp3 only (max 20MB)";
  pre-submit 20MB size guard. (Chose 20MB: singer-songwriter focus first.)
- Task 2b — 3-track cap + delete + UI (commit f880db48).
  Server: MAX_TRACKS_PER_ARTIST=3 enforced in uploadTrackAction; new deleteTrackAction
  (ownership-checked, reuses existing safe deleteTrack -> explicit per-key
  removePrivateObject on originalKey+previewKey, NO wildcards).
  UI: new track-delete-button.tsx (two-step confirm); Music.tsx renders delete per track
  (gated on canUpload), swaps form for amber limit notice at cap, shows "N of 3 tracks used".
  Full loop verified on staging: upload to 3 -> form replaced -> delete -> form returns.
- All three pushed: d72a3f75..f880db48 feature/audio-pipeline -> origin.
- Task 4 — FFMPEG_PATH durability RESOLVED (no commit; host + env change).
  KEY FINDING: PROD runs BARE-NODE via PM2 (process 'peerify', ~/apps/peerify-app/circles,
  fork mode, server.js), NOT Docker. The repo Dockerfile exists but prod isn't deployed
  through it. Prod had: no FFMPEG_PATH, no system ffmpeg, no ffmpeg-static — all 3
  resolution paths would have failed -> every upload would break at transcode. Caught
  BEFORE merge (prod still on main, no audio yet).
  FIX: installed system ffmpeg on the host (apt; ffmpeg 6.1.1, /usr/bin/ffmpeg, libmp3lame
  present, selftest produced valid MP3). One install covers staging + prod (same box).
  Aligned staging to match prod: commented out FFMPEG_PATH in staging .env.local so the
  resolver (src/lib/audio/ffmpeg.ts) falls through to system ffmpeg on PATH.
  PROVEN: deleted+restarted peerify-staging (now id 5) with NO FFMPEG_PATH in process env;
  upload transcoded with zero ffmpeg errors. Staging now resolves ffmpeg identically to
  how prod will -> no more FFMPEG_PATH fragility on either env.

### Learnings (deploy mechanics — important)
- Staging standalone server runs from the NESTED path
  .next/standalone/apps/peerify-staging/circles/circles/ — static + public must be copied
  THERE, not to .next/standalone/. build.sh copies to the wrong (un-nested) path for this
  layout. Correct staging deploy: `CI=1 bun run build` (skips build.sh's wrong copy) then
  manual `cp -r .next/static` and `cp -r public` into the nested standalone dir.
- PM2 env: a subshell `source .env.local` does NOT reach the PM2 process. Must export into
  the shell (set -a; source ../.env.local; set +a) THEN start/restart. `source` never
  UNSETS a var removed from the file — a stale FFMPEG_PATH can linger in the shell; use
  `unset FFMPEG_PATH` before re-sourcing. Verify with `pm2 env <id> | grep -i ffmpeg`.
- No ecosystem file for staging; started via raw `pm2 start server.js --name
  peerify-staging` with PORT=3001 from the nested standalone dir, inheriting sourced env.
- deploy-genesis2.sh is the KAMOONI/Docker prod script (EXPECTED_DIR=/root/circles/circles,
  docker compose, kamooni.org version check) — NEVER run it on the peerify box.
- ffmpeg is now a HOST dependency. If the Hetzner box is rebuilt: `apt install ffmpeg`
  must be redone, or audio transcoding breaks on both envs.

### Carry-forward
- (DONE: old items 1, 2, 4.)
- Task 3 — sharp._isUsingX64V2 on staging bare-Node (broken images). NOTE: the Dockerfile
  already hand-installs sharp@0.33.5 + libvips for the (unused) Docker path; staging
  bare-Node still has the native mismatch. Prod bare-Node likely affected too — verify.
- Task 5 — PROD Stripe apiVersion: verify deployed prod stripe.ts apiVersion vs prod's
  installed SDK type (donations could silently fail). Read-only check, do anytime.
- auth.ts DEBUG logs + [ADMIN DEBUG] in admin/page.tsx still present on this branch.
- Merge feature/audio-pipeline -> main: must preserve Tracks + private-media; must NOT
  reintroduce db/bucket hardcodes or the 2026-05-27 apiVersion; ensure NO FFMPEG_PATH is
  set on prod (rely on system ffmpeg). Prod is bare-Node — deploy mirrors staging mechanics.
- mc alias / peerify-media bucket contents still unconfirmed; also verify deleted-track
  storage objects actually removed (Task 2b delete cleanup — couldn't confirm bucket-side).
- Pre-existing (unrelated) error: GET /uploads/.env -> MinIO NoSuchKey for key '.env' on
  circles-staging. Investigate separately.
- SECURITY: MINIO_ROOT_PASSWORD for staging was surfaced in plaintext during this session;
  rotate when convenient. Remove .env.local.bak-* backups containing it.

### Environment notes (updated)
- Staging: bare-Node PM2 'peerify-staging' (now id 5) port 3001, DB peerify_staging,
  bucket circles-staging, APP_DIR /home/tim/apps/peerify-staging-data, env at
  /home/tim/apps/peerify-staging/circles/.env.local (one level up from worktree).
  FFMPEG_PATH now COMMENTED OUT — uses system ffmpeg on PATH.
- Prod: bare-Node PM2 'peerify' (id 0) port 3000, source ~/apps/peerify-app/circles,
  branch main. No FFMPEG_PATH (correct). System ffmpeg now installed.
- Host: /usr/bin/ffmpeg 6.1.1 (apt) — shared dependency for both envs.



## 2026-06-28 — Audio pipeline WORKING on staging; isolation regression found & fixed

### Done
- Deploy script (scripts/deploy-peerify.sh): npm -> bun --frozen-lockfile. Both prior
  traps (env-source via set -a/source .env.local, static-copy) already present.
  Commit f38aa4a2 on main.
- DEBUG logs removed from db.ts/auth.ts on main (7039086f). main + staging pushed to origin.
- CRITICAL: feature/audio-pipeline predated yesterday's isolation fix, so it carried
  hardcoded db.ts (client.db("circles")) and storage.ts (bucketName="circles").
  Switching staging to this branch silently read PROD's DB -- caused the globe showing
  prod profiles, the login confusion, and "email already in use" on signup.
  Fix: ported both fixes surgically, PRESERVING Tracks collection wiring + the
  Peerify private-media block in storage.ts. Commit fba55bbc.
- stripe.ts: apiVersion -> 2026-03-25.dahlia to match installed stripe 22.0.2 SDK type
  (node_modules/stripe/cjs/apiVersion.d.ts). 2026-05-27 does NOT type-check on this SDK.
- ffmpeg.ts: removed orphaned eslint-disable (@typescript-eslint/no-var-requires rule
  not registered under next/core-web-vitals) -- was breaking the build.
- Signup -> Postmark email -> admin promotion all verified on staging (new tim-admin
  account, isAdmin set via DB; /admin guard checks only user.isAdmin).
- AUDIO PIPELINE WORKS END-TO-END on bare-Node staging (NO Docker needed):
  ffmpeg-static binary runs; transcode to MP3 succeeds via FFMPEG_PATH env override.
  NOTE: standalone build does NOT bundle the ffmpeg-static binary -- require() resolves
  to a mangled .next/server/.../ffmpeg path -> ENOENT; FFMPEG_PATH bypasses it.
  "Love Oblivious" uploaded, transcoded, streams + plays. Tracks doc in peerify_staging.

### Carry-forward
1. Player: make PLAY-ONLY -- remove download option; ensure no attachment Content-Disposition.
2. Upload limits: MP3-only + file size cap (~20-30MB), client + server side.
3. sharp._isUsingX64V2 error -> broken images on staging (native binary mismatch).
4. FFMPEG_PATH durability for PROD -- currently points at source node_modules; needs a
   stable path (copy binary in deploy step, or fixed install location).
5. PROD Stripe apiVersion: verify deployed prod isn't sending an apiVersion the live SDK
   rejects (donations could silently fail). Check prod stripe.ts vs prod installed SDK.
6. auth.ts DEBUG logs + [ADMIN DEBUG] in admin/page.tsx still present on this branch.
7. Audio branch: push fba55bbc; eventual merge->main must preserve Tracks + private-media
   and NOT reintroduce db/bucket hardcodes or the 2026-05-27 apiVersion.
8. mc alias 'local' unconfirmed -- verify peerify-media bucket contents when convenient.

### Environment notes
- Staging: bare-Node PM2 (peerify-staging, port 3001), DB peerify_staging, bucket
  circles-staging, APP_DIR /home/tim/apps/peerify-staging-data, env at
  /home/tim/apps/peerify-staging/circles/.env.local (one level up from worktree).
- FFMPEG_PATH added to staging .env.local pointing at source node_modules ffmpeg binary.

---

## 2026-06-27 (cont.) — Hardcoded "circles" audit: COMPLETE, no further bugs

Ran `grep -rn '"circles"' src/`. ~60 hits, all classified:
- Mongo $lookup `from: "circles"` and `db.collection("circles")` across
  task/feed/event/proposal/goal/discussion/membership-requests/verification-workflow/db.ts
  — these are the COLLECTION name, genuinely "circles" in both prod and staging. CORRECT, left alone.
- storage.ts:38 `MINIO_BUCKET || "circles"` — the fix's fallback. Correct.
- middleware.ts:56/60 — URL path routing ("/circles" segment). Correct.
- vdb.ts (Qdrant vector collection "circles", ~7 hits) — the only other candidates,
  BUT: no QDRANT/VDB/VECTOR env in either .env.local, and no Qdrant running on :6333.
  Dormant code, never executes. Not a live bug. Revisit IF vector search is ever enabled.
Conclusion: db.ts + storage.ts were the ONLY live isolation bugs. Isolation now fully closed.

---

## 2026-06-30 — Cleanup sprint: MinIO rotation, staging↔main sync, branch + log hygiene

### Done
- **PEERIFY_CONTEXT.md replaced** with the consolidated 512-line version (§0 Build
  Status + §00 Roadmap + §1–§11 bible), superseding the stale 117-line repo copy.
  Committed via detached throwaway worktree at /tmp (main is checked out in the prod
  worktree, so can't be checked out twice). Tracked path is circles/PEERIFY_CONTEXT.md
  (NOT repo root — a stray UNTRACKED root-level copy still sits in the prod worktree;
  delete it next session, it's a confusion trap).
- **MINIO_ROOT_PASSWORD rotated** (was exposed plaintext in prior + this session).
  MinIO runs as systemd `minio.service`, bound 127.0.0.1:9000 (console :9001), creds in
  /etc/default/minio. BOTH apps authenticate AS ROOT (MINIO_ROOT_USERNAME=peerifyminio +
  password) — shared infra, one MinIO serves staging + prod. Rotated in 3 places:
  /etc/default/minio, prod .env.local (repo root), staging .env.local (one level up).
  Backups taken (.bak.<ts>) before edits. Restarted minio, verified new cred via mc
  admin info, then restarted both PM2 apps. Verified: prod uploads+plays, staging streams
  existing tracks. NOTE: best practice is per-app service accounts (mc admin user svcacct),
  NOT apps using root — deferred, but worth doing.
- **ffmpeg resolver fix synced to staging (Task 1).** Staging was on fix/ffmpeg-resolver
  (116e9394), which PREDATED the resolver fix that's on main — ironic given the name.
  Set up a dedicated `staging` branch (was diverged: carried unique commit 9fee32ec, a
  15-line SESSION_LOG audit note, and was missing 10 main commits). Cherry-picked 9fee32ec
  onto main FIRST (preserved the audit note; resolved a content conflict — both sides
  appended after the same anchor, kept both), THEN reset `staging` --hard to origin/main,
  force-pushed. Rebuilt staging (manual: bun run build → copy .next/static + public to the
  NESTED .next/standalone/apps/peerify-staging/circles/circles/ path → sourced PM2 restart).
  Upload verified working on staging.
- **Branch cleanup (Task 6 + bonus):** deleted fix/ffmpeg-resolver and feature/audio-pipeline
  (both fully merged), local + origin. Branch list now just main + staging.
- **Removed DEBUG getOpenEventsForListAction log (Task 4).** It WAS still present at
  src/components/modules/circles/map-explorer-actions.ts:53–59 (context doc wrongly said
  "not in current source") — 7-line block (debugId/has/console.log). Removed.
- **Untracked + gitignored .claude/settings.local.json (Task 5).** It was tracked (it
  shouldn't be — per-machine Claude Code permissions w/ absolute paths). git rm --cached +
  added rule to circles/.gitignore. (.claude/ contained ONLY this file.)
- Both code changes (Task 4+5) committed together (fbc95685) on main, ff'd to both worktrees.

### Learnings (mechanics — important)
- **PM2 env contamination is a real hazard across one shell.** Sourcing staging's .env.local
  (PORT=3001) then running `pm2 restart peerify --update-env` for PROD pushed PORT=3001 onto
  prod → EADDRINUSE crash-loop (prod down ~3 min). `--update-env` MERGES shell env onto the
  saved def and does NOT clear it; even `unset PORT` didn't help because PM2's SAVED def had
  been poisoned. Fix: `PORT=3000 pm2 restart peerify --update-env` to override, then `pm2 save`.
  RULE: restart each app in a FRESH shell (or explicit PORT=), and verify `echo PORT` BEFORE
  the restart. Prod .env.local has no PORT (relies on PM2 saved def); staging .env.local sets
  PORT=3001.
- **deploy-peerify.sh is PROD-ONLY** — hardcodes `cd ~/apps/peerify-app/circles`, the prod
  standalone path, and `pm2 delete peerify` + `PORT=3000 --name peerify`. Running it from the
  staging worktree would rebuild+restart PROD, not staging. Same foot-gun class as
  deploy-genesis2.sh (Kamooni). Staging has NO deploy script — use the manual sequence above.
- **package.json `build` = `cross-env IS_BUILD=true next build`** (just compiles, no copy).
  `build.sh` is a SEPARATE wrapper that copies to the UN-nested .next/standalone/ path (wrong
  for staging) only when CI is unset. Staging deploy: don't use build.sh; copy manually to nested.
- **circles/.gitignore line 61 `circles/` is overly broad** — matches ANY dir named circles,
  incl. src/components/modules/circles/. Tracked files there survive only because they predate
  the rule; new files would be silently ignored (hit this — needed `git add -f`). Likely meant
  to be `/circles_data` style root-anchored cruft from the Circles fork. FIX NEEDED: anchor it
  (leading slash) or scope it — but confirm what it was meant to ignore first.

### Carry-forward
1. **Task 2 (deferred to EOD):** audit + remove inherited Kamooni/Cleura/Circles docs
   (SESSION_LOG lineage from Kamooni, docs/cleura_deployment.md, docs/circles-deployment.md,
   docs/circles-registry-deployment.md, root deploy-genesis2.sh). Inventory docs/ with previews,
   triage {Kamooni→remove, Circles-generic→keep, Peerify→keep}, git rm in one reviewable commit.
   NO bulk-delete.
2. Delete the stray UNTRACKED root-level PEERIFY_CONTEXT.md in the prod worktree.
3. Fix the broad `circles/` gitignore rule (line 61) — see Learnings.
4. `DEBUG AUTH:` logs still printing on staging boot (auth.ts) — known carry-forward, remove.
5. Consider MinIO per-app service accounts instead of apps using root.
6. Optional: remove the `circles-origin` remote (leftover from the shared-Circles-repo migration;
   shows as remotes/circles-origin/product/peerify).
7. Session cleanup: delete /tmp/minio_newpw.txt and the .env.local.bak.* / etc files once the
   new MinIO password is saved in the password manager.
8. Task 4+5 are code changes on main but NOT yet rebuilt into prod/staging running apps
   (harmless console noise) — they'll ship with the next normal rebuild of each.

### Environment notes (unchanged, confirmed this session)
- Prod: PM2 `peerify` (id 8) :3000, branch main, source ~/apps/peerify-app/circles,
  env at ~/apps/peerify-app/circles/.env.local (REPO ROOT), standalone server at
  .next/standalone/apps/peerify-app/circles/server.js. No PORT in env (PM2 saved def).
- Staging: PM2 `peerify-staging` (id 5) :3001, branch staging, source
  ~/apps/peerify-staging/circles/circles, env at ~/apps/peerify-staging/circles/.env.local
  (ONE LEVEL UP), standalone at .next/standalone/apps/peerify-staging/circles/circles/server.js
  (NESTED). PORT=3001 + FFMPEG_PATH=/usr/bin/ffmpeg in env.
- MinIO: systemd minio.service, 127.0.0.1:9000, /var/lib/minio/data, creds /etc/default/minio.
  Both apps auth as root (peerifyminio). New password rotated this session.
- Branches: main + staging only. All three refs (main, staging, origin/*) aligned at fbc95685.
