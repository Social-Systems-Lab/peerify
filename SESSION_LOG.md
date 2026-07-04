# Peerify — Session Log

Live at: https://peerify.one  ·  Staging: https://staging.peerify.one
(This log was migrated from the Kamooni/Circles repo during the 2026-06 split; entries before ~June 2026 describe Kamooni lineage and shared Circles work.)

---

## Current Status (2026-06-27)
- Production: https://peerify.one — live, HTTPS (nginx + Certbot), PM2 process `peerify` on :3000, branch `main`.
- Staging:    https://staging.peerify.one — live, isolated, PM2 process `peerify-staging` on :3001, branch `staging`.
- Build tool: bun. Runtime: Next.js standalone via PM2 (not Docker).
- See OPERATIONS.md for full architecture and deploy procedure.

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

## 2026-07-03 — Artist page sidebar makeover

Goal: Clean up artist profile layout ahead of July 15 milestone — remove redundancy,
relocate sections, add a Support placeholder for the crowdfunding tease.

Starting point: design discussion using old peerify-artist-profile-v5 mockup as north star
(not to be mimicked yet — MVP-minimalist approach agreed for now).

Layout changes shipped to staging (AboutPage.tsx):

1. Removed redundant main-column Cape Town pill and LISTEN block — sidebar's Band Info card
   already covered Location + Listen & Follow from the same data source (peerifyArtistProfile.baseCity,
   peerifyMusicLinks).
2. Removed the "Featured Link" feature entirely (not hidden) — placeholder being replaced later
   by a real Peerify-hosted player. Touched 3 files: type def (artist-profile.ts), settings form
   (about-settings-form.tsx), and AboutPage.tsx display block. No DB migration needed (was a JSON
   key, not its own column). Availability's wrapping grid collapsed to single-column since it
   lost its 2-col grid partner.
3. Moved "Open To" (Shows/Festivals/Fans) from main column into its own sidebar section.
4. Added a new "Support" sidebar section — static placeholder, "Ways to get involved" subheader,
   3-item bullet list (help make a show happen / join a tour crew / volunteer), "more coming
   soon" note. No backend, no data props — pure UI tease for the crowdfunding campaign.

Bug found and fixed: sidebar cards use explicit `md:order-N` values (not JSX position) to
control visual stacking. Step 3's card was given `md:order-[1.5]` — an INVALID CSS order value
(must be integer) — which caused it to render at the very top instead of between Band Info and
Funding Panel. Fixed by renumbering all 11 sidebar cards to valid integers in multiples of 10
(order-[10] through order-[110]), leaving room for future insertions without needing to touch
existing cards again.

Design iteration — merge attempt reverted: tried merging Band Info + Open To + Support into
ONE card (single shadow, three labeled sub-sections) to reduce visual clutter. In practice this
looked WORSE — three plain-text sections with no boundaries read as an undifferentiated block,
not a cohesive "grouped" panel. Reverted back to three separate cards, but upgraded Open To and
Support to match Band Info's rounded/shadow styling (previously they were flat `bg-white p-6`
with no shadow) — this got the "finished" visual appeal without sacrificing section boundaries.
Lesson: don't merge visually-labeled sections into one card just to reduce card count — test
visually before assuming fewer boxes = cleaner. Matching styling across separate cards achieves
cohesion better than merging.

Final sidebar order: Band Info (order-[10]) → Open To (order-[20]) → Support (order-[25]) →
Funding Panel (order-[30]) → [existing cards unchanged, order-[40] through order-[110]].

Deploy notes: every step followed staging build → static/public asset copy → pm2 restart →
visual check on staging.peerify.one. Standalone builds do NOT copy .next/static or public/ —
this must be done manually after every build, or logo/hero/favicon break. Cost real time this
session before being caught; same underlying pattern as the June 27 static-copy finding above.

Not done this session (flagged, deferred):
- deploy-staging.sh script (still doing manual asset copy each time)
- Pages/Modules "de-Kamooni" audit — Funding Panel questioned as a possible Kamooni-inherited
  artefact rather than a deliberate Peerify feature; needs its own inventory session
- Repo docs cleanup (Kamooni-flavored SESSION_LOG.md/CLAUDE_CONTEXT.md still live on GitHub vs.
  the correct local PEERIFY_CONTEXT.md) — scoped already in PEERIFY_CONTEXT.md §00 item 2.
  This session's log update (replacing the stale Kamooni SESSION_LOG.md on GitHub with this
  document) is a first step toward that cleanup.
- Contact model, song-display polish, city↔map unification — explicitly deferred at session start
