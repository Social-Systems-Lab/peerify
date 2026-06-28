# Peerify — Session Log

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
