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

## 2026-07-09 (cont. #2) — Promoted isVerified auto-verify overhaul + banner/reply-bug fixes from staging to main/prod

Headline: Promoted the full day's-plus-yesterday's staging work (6 commits: `08dc5fd7`, `7e27e380`, `b072270a`, `83eafc69`, `2f4f32c9`, `3a1acc75` — the `isVerified` auto-verify overhaul and today's four follow-up fixes) into `main` and deployed to prod. Merge and build were verified before touching the live process; the actual deploy then ran clean.

**Pre-promotion verification (no changes to prod yet):**
- Confirmed local `main` matched `origin/main` after a fresh fetch, then diffed `main..origin/staging` and confirmed the commit list was exactly the expected 6 — nothing unexpected.
- Merged `origin/staging` into local `main` (`--no-ff`, merge commit `1cd9f105`) — clean, only an auto-merge on `PEERIFY_CONTEXT.md`, no conflicts. Not pushed yet at this point.
- **Build-only safety check, done without touching the running prod process:** inspected the live `peerify` PM2 process directly via `/proc/<pid>/cwd` and confirmed its working directory is `.next/standalone/apps/peerify-app/circles` — nested *inside* the exact `.next/` directory the prod deploy script (`scripts/deploy-peerify.sh`) deletes and rebuilds in place. Rather than build in the real prod worktree (which would have overwritten live-serving static files mid-build), built the merged `main` in an isolated detached worktree (`/tmp/peerify-prod-build-check`, same precedent as the 2026-06-28 audio-pipeline merge session) instead. Confirmed: build succeeded, all routes compiled, `.next/static`/`public` populated, the new check-email copy present in the built output, and the old amber banner markup absent — all with zero risk to the live process. Also confirmed neither existing deploy script fit a true "build-only, don't touch prod" ask: `deploy-genesis2.sh` is the stale Kamooni/Docker script (flagged separately in the carry-forward list below, not used), and `scripts/deploy-peerify.sh` has no dry-run mode (it always ends in a PM2 restart).

**Promotion:**
- Pushed local `main` to `origin/main` (`e754880a..1cd9f105`).
- Ran `scripts/deploy-peerify.sh` for the real deploy (build, copy `.next/static`+`public`+`VERSION` into the live standalone dir, `pm2 delete`/`pm2 start`, `pm2 save`).
- Verified after restart: `peerify` PM2 process online with a fresh pid and 0 restarts; `peerify-staging` completely unaffected (same pid, uptime unchanged); `http://localhost:3000/` and `https://peerify.one/` both 200; `peerify.one/signup/pilot/check-email` renders the new simplified copy live; the old amber "Complete your profile" banner markup confirmed absent from prod's static chunks; BUILD_ID matches between the top-level build and the standalone copy PM2 is serving from. Checked prod's error log for anything deploy-related — only pre-existing, unrelated noise (transient "Failed to find Server Action" errors from browser tabs that had the previous bundle open, which self-resolve, and a bot probing `/storage/.env`, which correctly 404s).
- `main`, `staging`, and prod are now all in sync at `1cd9f105`.

**Docs:** updated `PEERIFY_CONTEXT.md` §00 — items 16/17 and the staging→main promotion note marked resolved/promoted (previously said "staging only, not yet promoted to main").

---

## 2026-07-09 (cont.) — Simplified check-email popup; unified unverified-profile banners to plain red text; fixed Forum nested-reply phantom-success bug; kept the Unverified pill (confirmed functional)

Headline: Four items in one pass — two straightforward copy/style changes, one investigate-then-fix bug, one investigate-then-decide-to-keep. All four verified on staging via `deploy-staging.sh` (prod confirmed untouched throughout).

**1. Simplified the post-signup "Check your email" page** (`src/app/(auth)/signup/pilot/check-email/page.tsx`) — removed the "Recommended next step" box and the "Continue to Peerify"/"Back to login" buttons. Replaced with three short paragraphs (verification link sent to `[email]`; verification enables account recovery + may be asked for later; spam-folder note + an inline "click here to go directly to your profile" text link). The link reuses the `continueUrl` handle-based redirect logic already fixed earlier today (commit `2f4f32c9`) — confirmed unchanged and correct, no new redirect logic needed.

**2. Unified all "complete your profile" banners to plain red text.** This morning's amber-box restyle (`2f4f32c9`) was reverted in favor of the plain `text-sm text-destructive` treatment `ChatButton`'s `contactError` already used — same copy (`UNVERIFIED_PROFILE_EXPLAINER`), no box/border/background anywhere now. Touched `post-form.tsx`, `CommentSection.tsx` (both the top-level and nested-reply composer banners), and — after flagging it as a separate pre-existing inconsistency (a blue box, not amber) — `chat-room.tsx`'s `ChatInput` banner too, per founder direction to fold it into the same pass. Removed now-unused icon imports (`Info`, `IoInformationCircleOutline`) left over from the boxed versions.

**3. Investigated and fixed: unverified users could post a Forum nested reply (reply-to-a-reply) that appeared to succeed (visible immediately, timestamp + "Unverified" pill) but silently never persisted (gone on refresh).** Root cause: the Forum module (`discussions`, nav label "Forum") is a separate, largely-duplicated implementation of the comment/reply UI from the Noticeboard's (`src/components/modules/feeds/`) — `discussion-list.tsx`'s `CommentItem` had **no client-side verification gate at all** on replies (top-level or nested), unlike the already-correct `post-list.tsx`/`CommentSection.tsx`. The server (`createCommentAction` → `isAuthorized`, via `features.feed.comment`'s `needsToBeVerified`) was correctly rejecting the write the whole time — the bug was purely client-side: an optimistic local-state insert with no `else`/rollback branch when `result.success` was `false`, so the fake "posted" comment just sat in state until a refresh re-fetched the real list and it vanished. Fixed by mirroring the proven `CommentSection.tsx` pattern exactly: added a `canReply` check (`isAuthorized(user, circle, features.feed.comment)`), gated `handleAddReply`/the reply textarea render, added the failure-rollback + `UNVERIFIED_PROFILE_EXPLAINER` red-text banner (swapped in for the textarea when blocked). Also added the same banner to the Forum's top-level comment box, which previously just silently disappeared for unverified users with zero explanation (not exploitable the same way — the box is hard-gated off entirely — but inconsistent with "confirm banner styling is now consistent everywhere").

**4. Investigated: does the "Unverified" pill (`UserStatusBadge`) serve any real purpose on Peerify, or is it Kamooni-era cruft?** Confirmed it is *not* dead weight — `isVerified`/`verificationStatus` (which the pill visualizes) drives: feed-post visibility (unverified users' posts hidden from everyone but themselves), search/discoverability (`isDiscoverableCircle`), `getAllUsers`, platform stat counts, and — most importantly — is the literal signal for the `needsToBeVerified` authorization gate (`isAuthorized()`) enforced on every restricted action (posting, commenting, messaging, forum). The admin dashboard also has its own separate "Verified" pill + approve/reject actions. **Decision: keep the pill, no change made.**

**Verification:** `bun run lint` (no new errors, only pre-existing warnings) and `bun run build` both clean. Deployed via `deploy-staging.sh` (all 8 steps passed — build, BUILD_ID match, static-asset copy verified, staging restarted, prod pid/uptime confirmed unaffected, HTTP root + static-asset checks 200). Confirmed live via `curl` against `staging.peerify.one`: check-email page renders the new copy and the handle-based redirect link (`/circles/{handle}/home`); the old amber "Complete your profile" box markup no longer exists anywhere in the built JS bundle. **Caveat:** the reply-composer fix is a client-side rendering/state fix, and headless-browser click-through verification was not available in this environment (Playwright's Chromium still missing system shared libraries — `libnspr4.so` etc. — same blocker as 2026-07-08/07-09 sessions; `sudo apt install` declined again without explicit go-ahead). Verified instead via clean build + exact mirroring of the already-proven `CommentSection.tsx` gating pattern, not live click-through — flag for a future session if/when headless-browser tooling becomes available.

**Carry-forward:** at the time this entry was written, none of this touched `main`/prod — staged only. **Since promoted 2026-07-09** (see the "(cont. #2)" entry above) — this work is now live on prod.

---

## 2026-07-09 — Resolved item-16 open issues: banner/admin-messaging root-cause (test-account state, not code), mission/description write-path bug fixed, welcome popup copy refreshed

Headline: Closed out the four open items from 2026-07-08's manual testing (§00 item 17). Root cause for the two "not working" reports turned out to be test-account sequencing, not a rendering bug — confirmed via a live staging-DB query. Found and fixed one genuine bug along the way (mission/description write-path mismatch) plus two smaller consistency gaps, and shipped the stale welcome-popup copy update. All committed to `staging` (`b072270a`) and deployed via `deploy-staging.sh`.

**Investigation (read-only, three parallel passes):**
- **Banners not visible during 07-08 testing:** traced all three `UNVERIFIED_PROFILE_EXPLAINER` sites (`post-form.tsx`, `CommentSection.tsx`, `chat-room.tsx`'s `ChatInput`) — no dead branches, no CSS bugs, no early-returns blocking them in the normal case. Cross-checked against the live staging DB: of 8 `circleType: "user"` docs, 7 were already `isVerified: true` with `verifiedAt` timestamps from 2026-07-08 itself (same session as the testing) — meaning the test account(s) used had already auto-verified (picture+about saved first, to set up a realistic profile) before the blocked-state UI was ever exercised. The 8th account (`akro-batim`) was genuinely unverified but had never been exercised against post/comment/chat at all (no picture, no bio, looks abandoned mid-setup).
- **Admin-messaging "still blocked" report:** traced `getRestrictedActionMessage("contact circle admins")` (`src/lib/auth/verification.ts`) back through `ensureVerifiedMessagingUser()` (`mongo-actions.ts:69-84`, called from `contactCircleAdminsAction`) — confirmed it does a fresh DB read (not stale session/JWT data) keyed on the *sender's* own DID (not the admin's), and uses the same `isVerifiedUser()`/`canPerformRestrictedAction()` vocabulary as posting/commenting. Ruled out staleness, wrong-party, and legacy-field hypotheses. It is architecturally a separate code path from `isAuthorized()`/`needsToBeVerified` (a standalone helper local to `mongo-actions.ts`) — not currently buggy, but a duplication worth consolidating eventually.
- **Real bug found during the admin-messaging trace:** the Home tab's inline "click-to-edit" About field (`home-content.tsx`) used `id={circle.description ? "description" : "mission"}` — writing to `circle.mission` whenever `description` was empty. But `getVerificationReadiness()`/`hasAboutText()` (`src/lib/verification-readiness.ts:26-30`) only ever reads `description`/`content`, never `mission`. A user who completed their About text via that inline field (rather than the Settings page) could have visibly-saved text that silently never counted toward auto-verification, leaving `contactCircleAdminsAction` blocked forever despite an apparently-complete profile.
- **Mission-field safety audit** (before fixing the above): confirmed `mission` is still a live, separately-displayed field for regular community/org circles specifically — a dedicated Settings input (visible for circles that are not `isUserProfile`/managed-artist/managed-venue, per the 2026-07-05/06 Settings cleanup phases), a distinct "Mission" section on `AboutPage.tsx`, and its own quote-box treatment in `circle-swipe-card.tsx`/`content-preview.tsx`. Forcing the inline editor to always write `description` unconditionally would have silently orphaned mission content for those circle types — the fix needed to be scoped to personal profiles only.
- **Welcome-popup copy:** found in `home-content.tsx`'s `Dialog` (shows once per handle via localStorage, gated on `isOwnUserProfile` i.e. `circleType === "user"` viewing their own profile). Confirmed `HomeContent` is a shared component across all circle types, but the dialog itself never opens for non-personal circles, so the copy change is personal-profile-scoped by construction — safe to edit without touching artist/band/venue onboarding.

**Implementation (staging, commit `b072270a`):**
- `home-content.tsx`: welcome-popup copy replaced (removed "Request Verification"/admin-verification wording; new copy describes the picture+bio unlock mechanic, the private-by-default/trusted-contacts model, and a location-sharing caution).
- `home-content.tsx`: inline About editor's `id` now `isUser || circle.description ? "description" : "mission"` — personal profiles always write `description`; community/org circles keep their existing fallback behavior untouched.
- `post-form.tsx`: banner condition changed from raw `!user.isVerified` to `!canPerformRestrictedAction(user)`, matching the shared helper (and its admin bypass) used at the other two banner sites.
- `CommentSection.tsx`: added the same `UNVERIFIED_PROFILE_EXPLAINER` banner to the nested reply composer (previously only the top-level new-comment composer had it) — added a `canReply` check alongside the existing `canModerate`/`isAuthorized` pattern already used in the file.

**Verification:** full browser E2E via Playwright was attempted first (staging has no login-blocking on unverified email, and ALTCHA is a self-solving proof-of-work widget, so a scripted signup→test→complete-profile→retest flow was feasible) but blocked at launch — headless Chromium's cached binary needs system shared libraries (`libnspr4.so` etc.) not installed on the host, and installing them needs `sudo`. Given the choice, declined the `sudo apt` install for this session. Fell back to exercising the real production functions directly against the staging DB (same pattern as the 2026-07-08 session): inserted a throwaway `circleType: "user"` doc matching exact real-signup defaults (no picture, empty description, `verificationStatus: "unverified"`, `accountStatus: "pending_verification"`), then called `isVerifiedUser()`, `canPerformRestrictedAction()`, `isAuthorized()` (against a real *different* circle — tim-solo — since `isAuthorized` has a same-circle verification carve-out that would have made a same-circle test invalid), and `updateCircle()` directly:
- Confirmed the fresh doc is blocked from posting, commenting (on another circle's noticeboard), and admin-contact, with the exact expected message text.
- **Reproduced the bug live:** calling `updateCircle()` with a custom picture + `mission` text (the old buggy write path) did NOT auto-verify.
- **Confirmed the fix:** calling `updateCircle()` with `description` text instead DID auto-verify (`isVerified: true`, `accountStatus: "active"`), sent the one-time "profile complete" notification, and unblocked all three gates on re-check.
- Throwaway doc deleted after (one earlier doc from a failed first attempt — before a test-script bug involving the same-circle carve-out was caught — was also found and cleaned up).

Deployed via `deploy-staging.sh` — all 8 steps passed (build, BUILD_ID match, static-asset copy verified, staging restarted, prod pid/uptime confirmed unaffected, HTTP root + static asset checks 200). Pushed `staging` to origin.

**Carry-forward:** staging is now in good shape on this feature — see `PEERIFY_CONTEXT.md` §00 item 16/17 (updated) for the roadmap-level note. Not yet merged to `main`/deployed to prod (deliberate — no urgency signaled this session). The `ensureVerifiedMessagingUser()` vs `isAuthorized()` architectural duplication (two independent code paths both checking verification) is a minor cleanup candidate for a future session, not urgent since both are confirmed correct today.

---

## 2026-07-08 — isVerified auto-verify overhaul for personal profiles; two build-without-restart deploy incidents

Headline: Replaced the admin-approval-gated `isVerified`/`accountStatus` flow with an automatic one for personal (`circleType: "user"`) profiles — a fan is now verified (and unblocked from posting/commenting/messaging) the moment they add a profile picture and About text, with zero admin action. Artist/venue verification is completely untouched. Investigated first (three parallel research passes), implemented and deployed to staging, then a second pass fixed three UX gaps found in manual testing. Two deploy incidents (one on prod earlier in the day, one self-inflicted on staging later) both traced to the same root cause: `bun run build` + `pm2 restart` without copying `.next/static`/`public` into the standalone output dir. Committed to `staging` at `08dc5fd7` and pushed; **not yet merged to `main`** — see open items below.

**Investigation (read-only, no code changes yet):**
- Confirmed the Stripe/Donorbox membership webhooks (`applyStripeMembershipUpdate`, `src/app/api/donorbox/route.ts`) are fully implemented but **not live on Peerify** — no `STRIPE_*`/`DONORBOX_*` secrets configured in staging or prod env (confirmed via `/proc/<pid>/environ` on both running PM2 processes), and `docs/STRIPE_MEMBERSHIP_V1.md` confirms this is Kamooni's membership-dues feature on Kamooni's separate host. Pre-launch cleanup, not urgent.
- Confirmed `isVerified`/`accountStatus` ("Pending"/"Active") is NOT a legacy toggle — it's live infrastructure gating ~45 restricted actions (`needsToBeVerified` checks via `isAuthorized()`/`canPerformRestrictedAction()`: posting, commenting, chat, event/task/goal/proposal creation, music upload, etc.), hides unverified users' feed posts from everyone, and is the same field the (inactive) Stripe/Donorbox webhooks set on payment. This escalated the plan from "quietly retire it" to "needs a replacement gate first."
- Mapped the manual verification UI family (`verify-account-button.tsx`, `verification-readiness-checklist.tsx`, `verification-settings-card.tsx`, admin approve/reject, `verification-workflow.ts`): the personal-profile-facing pieces are cleanly separable via a conditional; the backend workflow/admin queue is genuinely shared with artist/venue verification (`requestType: "independent_circle"`) and must not be touched.
- Confirmed anonymous (logged-out) visitors can already view artist profiles and stream music end-to-end with no auth gate anywhere in that path (page load, track-list fetch, signed-URL redemption) — no fix needed there.

**Implementation (staging, commit `08dc5fd7`):**
- `src/lib/data/circle.ts`: `updateCircle()` auto-verifies a personal profile (`isVerified`, `verificationStatus`, `accountStatus: "active"`, `verifiedAt`, `verifiedBy: "system:auto-verified"`) once `getVerificationReadiness()` reports both picture and About text complete (correctly excludes the default placeholder avatar via existing `hasCustomPicture()` logic). Single hook point — covers both write paths (settings save, onboarding) since they funnel through the same `updateCircle()`. Forward-only, never revokes.
- Hid (commented out, not deleted) `VerifyAccountButton` in `home-content.tsx` and `user-toolbox.tsx`, and `VerificationSettingsCard` in `subscription-form-settings.tsx` — all three render sites were already personal-profile-only by construction, so hiding here has zero artist/venue impact. Backend `verification-workflow.ts` / admin queue untouched.
- Added `sendUserVerifiedNotification()` an optional `messageBody` param (`notifications.ts`) and wired a call into the new auto-verify branch in `updateCircle()` via a dynamic `import()` (needed to avoid a circular dependency, since `notifications.ts` already imports from `circle.ts`) — fires a one-time "Your profile is complete! You can now post, comment, and message on Peerify." notification. Confirmed no overlap with the signup welcome message (a separate chat-based system message with unrelated onboarding-links content).
- Added a shared `UNVERIFIED_PROFILE_EXPLAINER` banner constant (`src/lib/auth/verification.ts`) to the three places posting/commenting/chat is blocked or hidden for unverified users: `post-form.tsx` (replaced stale/inaccurate copy), `CommentSection.tsx` and `chat-room.tsx` `ChatInput` (previously silent — the input was just hidden with no explanation).
- Fixed `about-settings-form.tsx` showing two adjacent "Save Changes" buttons on the personal-profile About Settings page: a shared `renderSaveButton()` section-checkpoint helper is called 5 times through the form as markers between card sections; 4 of those calls were unconditional. For long artist/venue forms the gap between checkpoints has real content so it's unnoticeable; for the short personal-profile form, all the artist/venue-only content between checkpoints #1 and #3 is hidden, so those two buttons rendered back-to-back. Gated 3 of the 4 unconditional calls to `!isUserProfile`; personal profiles now get exactly one Save button (the final one), artist/venue multi-checkpoint behavior unchanged.
- Verified end-to-end on staging by exercising the real `updateCircle()`/`isAuthorized()`/`sendUserVerifiedNotification()` functions directly against throwaway documents in the staging DB (no headless-browser tooling available in this environment — apt install of headless-Chromium shared libs was declined): unverified user blocked from a restricted action → real picture+about save → verified, notified exactly once, unblocked → second save does not re-notify.

**Deploy incidents (both same root cause — asset-copy step skipped):**
1. **Prod outage, earlier in the day** (referenced, not directly worked in this session — already resolved by the time this session picked up).
2. **Staging outage, this session:** an earlier `bun run build` + `pm2 restart peerify-staging` in this session's deploy skipped copying `.next/static`/`public` into the standalone output dir (`/home/tim/apps/peerify-staging/circles/circles/.next/standalone/apps/peerify-staging/circles/circles/`) — confirmed via direct inspection (`.next/static` and `public` were completely absent from the standalone dir despite a matching, current `BUILD_ID`). Fixed by copying both directories in and restarting `peerify-staging` immediately after (prod pid/uptime confirmed unaffected throughout). Verified via `staging.peerify.one/explore` returning 200 with real static chunk/CSS references resolving. **All subsequent deploys this session used the repo's existing hardened `deploy-staging.sh`** (build → copy → verify BUILD_ID match → restart → verify prod untouched → HTTP root + static-asset checks, fails loudly on any step) instead of manual steps, per the script's own incident-driven design (see its header comment).

**Open items for next session (found in tonight's manual browser testing on staging, not yet diagnosed):**
- Stale "Request Verification" copy still visible somewhere in the signup flow — likely leftover wording from the old manual-verification path.
- The new explainer banners (post/comment/chat) did not actually appear during manual testing despite being deployed — needs investigation.
- Possible bug: an unverified user may still be able to comment when they shouldn't be — needs repro.
- An admin-messaging check was still blocked/incomplete during testing — needs follow-up on what specifically didn't work.

See `PEERIFY_CONTEXT.md` §00 items 16–17 for the roadmap-level summary and escalation note on item 11 (the pre-existing map/search `isVerified` discoverability leak, now more urgent since auto-verify means far more real accounts will trip it).

---

## 2026-07-05 (evening) through 2026-07-06 (morning) — Settings cleanup marathon: 5 phases (Skills/Questionnaire hide -> Booking fields removal)

Headline: A long, incremental Settings-page cleanup pass across personal, artist, and venue profiles, done as five separate reviewed-and-shipped phases over one evening-into-morning session. Each phase was its own commit on staging, verified, then promoted. The `isVerified` map/search discoverability issue surfaced mid-session and was investigated and logged separately (see `936e58c9` and §00 item 11 in `PEERIFY_CONTEXT.md`) rather than folded into this entry.

**Phase 1 — Hide Skills & Interests and Questionnaire from Settings sidebar** (commit `558408ce`)
Both nav items removed from the visible sidebar via a filter (not deleted), so they can be re-enabled later without touching routing.

**Phase 2 — Personal profile About Settings copy + hide Mission/Access & Permissions; rename Pages to Modules** (commit `3b861aeb`)
For personal (`circleType: "user"`) profiles only: reworded the intro paragraph, handle helper text, and website helper text for an individual/fan context instead of circle/org language; hid the Mission field and the Access & Permissions card (`isPublic`, `showAdminsPublicly`) behind an `isUserProfile` guard (reversible). Sidebar-wide: renamed the "Pages" nav item to "Modules" (label only). Verified on staging (`BUILD_ID -TF7qn1GCC12uHRuHRO55`).

**Phase 3 — Rename Artist Identity card, Producer->Musician, remove Base city field** (commit `10d89bef`)
Settings form: Artist Identity card title/helper text made generic for all managed identity types instead of per-type; Base city input removed from the form. `PEERIFY_ARTIST_TYPE_OPTIONS`: "Producer" renamed to "Musician" (confirmed via prod query first — no existing circle had "Producer" selected). Public About page and Home tab profile header: Base city display removed to match.

**Phase 3b — Hide Mission field for Artist and Venue profiles** (commit `504afe42`)
Extended the Phase 2 Mission hide to managed Artist and Venue identity circles too — guard now excludes `isUserProfile`, `isPeerifyManagedArtistCircle`, and `isPeerifyManagedVenueCircle`, leaving Mission visible only for regular (non-Peerify-managed) community/org circles.

**Phase 4 — Split Music Links and Looking for/Open to into their own cards** (commit `24e800c7`)
Artist Identity Settings previously bundled the music-link fields and the looking-for/open-to checkboxes as sub-sections inside the Artist Identity card. Gave each its own top-level Card/CardHeader/CardTitle, matching the other Settings cards on the page. No fields, labels, or behavior changed — visual reorganization only.

**Phase 5 — Remove Minimum/Preferred audience size and Needs accommodation/transport/meal from Booking settings** (commit `cc8614ce`)
Per founder direction, these fields were premature for the current product stage and will be redesigned later as a proper tiered structure (see new §00 carry-forward items on booking currency/tiered fees below). Removed from the Settings UI only (JSX inputs deleted, not conditionally hidden) — the underlying type, form defaults, and submit mapping in `AboutSettingsFormValues` were left untouched, matching the Base city precedent from Phase 3, so any existing stored values round-trip unchanged on next save instead of being wiped. Confirmed no other reads/displays of these fields exist (public About page, booking enquiry flow, search/filtering) before removing. Base fee, Currency, Technical needs, Booking notes, and Availability were left untouched.

While reviewing the Booking card during Phase 5, three new gaps were noted and logged to `PEERIFY_CONTEXT.md` §00 carry-forward (items 12–14) rather than fixed in-session: the public Booking card doesn't show the currency unit next to the base fee, currency itself isn't artist-selectable, and there's no support for location/market-based fee tiers — all deferred pending the broader booking-logistics redesign this phase's field removals are anticipating.

Each phase was committed directly to staging, spot-checked, then promoted to main (merge commits `78d80c5d`, `1d9e4fc4`, `154081e6`, `a2c7008a` interleaved between phases). All five phases verified present on `origin/main` at session end.

---

## 2026-07-01 — Investigation: missing artist music-links form; prod ground-truth verification

Headline: Investigated why the artist music-links form (Bandcamp/Spotify/SoundCloud/Apple Music/YouTube/Linktree on `/settings/about`) was visible on peerify.one a few days ago and isn't today. Root cause found: it wasn't a caching/build issue — the form was **deleted from source** by commit `044f52bd` as an unintended side effect. Read-only investigation, no code/build/restart changes made.

Findings:
- **Prod ground truth confirmed independently** (PM2 + `ss -ltnp` + `/proc/<pid>/cwd`, not just PM2's own records): `peerify` :3000 serves from `~/apps/peerify-app/circles`, tracking `Social-Systems-Lab/peerify.git`, branch `main`, HEAD `f7a4ebe6`, working tree clean.
- `~/apps/peerify/circles` is a **stale leftover checkout** of the old `Social-Systems-Lab/circles.git` repo — nothing serves from it. Not to be confused with prod.
- Prod's `peerify` PM2 process has been up since 2026-06-30 13:29 with **no restart since the 15:25 rebuild** that same day — meaning cached in-memory route modules are a possible confound for "what's actually being served" going forward; a clean restart is needed before trusting on-disk build state alone.
- **Root cause of the missing form:** commit `044f52bd` ("Remove artist-profile section from personal profile settings") added a personal-profile info banner (correct, `isUserProfile`-gated) but ALSO deleted the entire pre-existing Card gated on `canEditPeerifyArtistProfile = isUserProfile || isPeerifyManagedArtistCircle` — an OR condition. Because of the OR, the deletion removed the music-links form not just for personal profiles but for **actual Peerify-managed artist/band circles too**. This is a regression beyond what the commit message describes, confirmed via `git show 044f52bd` on the staging repo (`~/apps/peerify-staging/circles/circles`) and cross-checked against prod's current source (dead `canEditPeerifyArtistProfile` variable at `about-settings-form.tsx:383`, unused — it's evidence, not lint).
- Compiled build on disk confirmed to match source (no "Music links" form in the current `.next/standalone` build either) — ruled out a stale-build explanation for the *current* absence; the removal is a genuine source-level regression, already present at prod's HEAD.

Action queued: see 🔴 TOP PRIORITY item in `PEERIFY_CONTEXT.md` §00 Roadmap — restore the artist/band music-links form (from `044f52bd`'s parent), gated correctly for artist/band circles only, without Spotify. Blocks staging→main promotion.

- **RESOLVED:** artist/band settings Card restored (commit `6c30ad88`), gated on `isPeerifyManagedArtistCircle`, Spotify removed. Verified rendering on staging (:3001): full artist form on artist/band circles (Band Identity notice, artist types, base city, genres, music links minus Spotify, featured link, looking-for, booking sub-form, save button); personal profiles correctly show amber banner + NO card. Data round-trips (Bandcamp URL populated).
- Staging now has 4 unpushed commits ahead of prod: `4ca8d0e2`, `db0cd33c`, `af15bc5f`, `6c30ad88` (plus doc commits). All verified.
- **NEXT SESSION (dedicated, fresh):** promote staging→main. Sequence: from prod worktree `~/apps/peerify-app/circles`, `git fetch && git merge --ff-only origin/staging`; prod build; PORT-safe restart (fresh tab, `echo $PORT` must be empty/3000, `--update-env`); `pm2 save`. This restart also clears prod's stale cached modules (process up since before last rebuild).
- Deferred cleanup (separate session): remove now-dead `canEditPeerifyArtistProfile` const; general artist-settings polish.
- **PROMOTION COMPLETE:** merged staging into main (merge commit 1f26690f), built prod, PORT-safe restart (staging undisturbed), pm2 save. Verified live on peerify.one: artist/band settings form restored + rendering, Spotify absent, funding block gone, "Post as:" label, personal profiles show banner. Prod, staging, main now in sync. Prod process refreshed (stale cached modules cleared).

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

---

## 2026-06-30 (cont.) — Artist section removal, amber profile banner, branded default avatars, prod promotion

Headline: UI cleanup sprint for the personal-profile settings page — removed the confusing artist-profile section, replaced it with a calm amber informational banner, and rolled out Peerify-branded default avatars app-wide. All changes promoted to prod via fast-forward.

### Done

- **Artist profile section removed from personal-profile About settings** (`about-settings-form.tsx`).
  The `{canEditPeerifyArtistProfile ? (<Card>…</Card>) : null}` block (lines 753–1120 pre-edit) and the preceding `{renderSaveButton()}` were removed from the JSX — 370 lines total. The `peerifyArtistIntent` form field default and save assembly were deliberately LEFT intact; this was a UI-only removal (the field still round-trips silently). The variable `canEditPeerifyArtistProfile` is now declared but unused — confirmed zero non-rendering references across the entire repo before cutting. Dead var left in place for now (see carry-forward).

- **Personal-profile amber info banner added** (`about-settings-form.tsx`).
  Gated on `isUserProfile && !bannerDismissed`. Styled as the app's established amber notice idiom: `rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-4 text-sm text-amber-950`, matching `verification-readiness-checklist.tsx:10` and `home-content.tsx:170`. Content: "This is your personal profile" (heading) / "It's private by default and represents you as a person." / "Artists, bands, and venues are separate identities. To create one, use the + Create button in the left sidebar."
  Dismiss: `useEffect` reads `localStorage.getItem("peerify_personal_profile_banner_dismissed")` on mount (SSR/hydration-safe — NOT inline) and calls `setBannerDismissed(true)` if found. Ghost-variant dismiss button (right-aligned, amber-toned) writes the key and updates state. Both localStorage operations are try/catch guarded for private-mode safety. `useEffect` added to the existing `useState` import line.

- **Peerify-branded default avatars replaced** (4 files, all 512×512 PNG).
  Replaced generic grey placeholder images with Peerify-branded orange-on-dark versions, optimized via pngquant (~1.6 MB → 32–52 KB each):
  - `public/images/default-user-picture.png` — personal profile / user silhouette
  - `public/peerify/default-artist-avatar.png`
  - `public/peerify/default-band-avatar.png`
  - `public/peerify/default-venue-avatar.png`
  Originals backed up as `*.bak` files on both staging and prod. A `*.bak` rule was added to the repo root `.gitignore` to prevent accidental commit of backups.

- **Root-level `.gitignore` added** (`.env`, `.env.local`, `.env*.local`).
  The repo root had no `.gitignore`; staging `.env.local` had been briefly committed and needed a `git reset`. Root `.gitignore` now closes that gap. (The app's own `circles/.gitignore` already covered the worktree level.)

- **Promoted to prod**: fast-forward `main` → `7c028d29`, `bun run build`, static + public copied into `.next/standalone/apps/peerify-app/circles`, `pm2 restart`.

### INCIDENT (resolved): prod restart → 502 / EADDRINUSE on port 3001

**Cause:** SSH shell still had `PORT=3001` exported from an earlier staging `set -a; source .env.local`. Running `pm2 restart peerify --update-env` merged the shell env onto PM2's saved definition, writing `PORT=3001` to prod — colliding with the staging process already on 3001. Prod entered a crash-loop; nginx returned 502 for ~3 minutes.

**Fix:** `export PORT=3000` in the contaminated shell, then `pm2 restart peerify --update-env`, then `pm2 save`.

**Rule reinforced:** restart each PM2 app in a **FRESH shell** (or prefix `PORT=3000` inline). Run `echo $PORT` BEFORE every restart. `--update-env` is a MERGE onto saved state, not a replacement — shell contamination propagates silently. This is the same hazard documented in the 2026-06-30 cleanup-sprint Learnings above; this incident is a second real-world instance of it.

### Carry-forward

1. **Songwriter identity type** — new managed-identity type to add: constant `PEERIFY_DEFAULT_SONGWRITER_AVATAR_URL`, wire into `getPeerifyDefaultAvatarUrl()`, `PEERIFY_ARTIST_TYPE_OPTIONS` / identity-type list, and the Create flow. Optimized avatar already prepared locally, not yet placed in repo.
2. **`default-profile-avatar.png`** (`public/peerify/`) still un-optimized at ~1.6 MB — needs pngquant pass separately.
3. **Banner flash-on-reload** — localStorage-gated banners (this one + Verify Profile) flash for one render frame before `useEffect` hides them. Fix consistently with a mounted-guard pattern or server-side preference store.
4. **Dead `canEditPeerifyArtistProfile` var** — `about-settings-form.tsx:372`, declared but never used — remove in next cleanup commit.
5. **Personal profile still renders circle chrome** ("Manage your circle's profile…", Pages / User Groups / Access Rules / Follow Requests nav items) — de-Kamooni audit, separate task.
6. **`kam-yellow` / `kam-hero-yellow` color tokens** — Kamooni-named brand tokens still in `tailwind.config.ts`; rename to brand-neutral in upcoming palette overhaul.
7. **Over-broad `circles/` rule in `circles/.gitignore` ~line 61** — matches any directory named `circles`, including `src/components/modules/circles/`. Anchor or scope it (confirm what it was meant to ignore first).
8. **`*.bak` avatar backups on staging + prod** — delete once prod is confirmed stable. It is; delete next session.

## 2026-07-03 — Band Info sidebar card promoted to prod
- Shipped: Band Info card on artist/band profiles (AboutPage.tsx, +82 lines, additive). Adds two-column layout via hasBandInfoContent folded into hasSidebarContent OR-chain; card shows Location (metadata.peerify.artistProfile.baseCity), Website, and Listen & Follow brand icons (react-icons/si; bandcamp/soundcloud/appleMusic/youtube/linktree, no Spotify). Personal profiles unaffected (gated on isPeerifyArtistProfile).
- Commits: ea18803b (staging) -> merge a0df7f86 (main). Verified live on peerify.one/circles/the-band/home; personal-profile regression check clean.
- INCIDENT 1 — phantom commit: Claude Code reported committing the card but the change was left staged/uncommitted in the staging worktree. It rendered live on :3001 anyway because staging serves the built working tree. Caught by the Checkpoint-2 fetch/divergence gate (staging..main was empty). Fix: committed properly (ea18803b) then pushed. LESSON: always confirm the commit actually landed (git log/status) before treating a Claude Code "committed" as done.
- INCIDENT 2 — blank Explore mid-deploy: copying fresh .next/static onto the live standalone dir while the OLD process was still running caused a build/manifest mismatch ("Failed to find Server Action") site-wide, in incognito and Brave too. NOT browser cache. Resolved by the pending PORT-safe restart, which realigned the in-memory manifest with on-disk files. LESSON: on prod, run copy + restart back-to-back with NO pause, and do not load the live site in the gap between them.
- Deploy hygiene held: empty PORT confirmed before restart; staging (id 5) undisturbed; pm2 save after health confirmed; main pushed to origin.

### Artist-page makeover backlog (next design session, mockups as north star)
- Resolve sidebar/main redundancy: once Band Info card owns Location + Listen & Follow, remove the duplicate "Cape Town" and "LISTEN" pills from the main column.
- Remove Featured Link placeholder (its future is the Peerify-hosted main track/video player; check nothing else references it before removing).
- Move "Open To" (Shows/Festivals/Fans) into the sidebar (inside Listen & Follow card or its own small card beneath it — TBD).
- New "Support / Get Involved" card below Listen & Follow: fan-participation invite (help make a show happen, join tour team, volunteer). This is the on-profile expression of the fan-hosted touring USP + pledge-to-bring mechanic; needs design thought on actions offered and who-sees-what.
