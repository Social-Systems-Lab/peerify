# Peerify — Context Document

A working handoff document for the Peerify platform, written for use across AI sessions. Assumes the reader knows Kamooni and the Circles codebase.

**This document has two layers:**
- **§0 Build Status** and **§00 Roadmap** track *what is actually built and where it's going* — updated every session, freshest at the top.
- **§1–§11** are the product & design bible — the canonical vision, mechanics, pricing, and design system. Stable; changes rarely.

For the detailed engineering changelog, see `SESSION_LOG.md` (this doc is the overview; SESSION_LOG is the play-by-play).

---

## §0. Build Status — current reality

*Last updated: 2026-09-01; infrastructure section updated 2026-11-02 (move to Cleura). Features shipped since 2026-09-01 are in `SESSION_LOG.md`.*

### Live on production right now (peerify.one)
- **Signup + auth** — personal-account-first signup, email confirmation, login/session. ALTCHA human-verification on signup (self-hosted, open-source).
- **Artist profiles** with a **Music module**: MP3 upload (mp3-only, 20MB cap), ffmpeg derivative generation, signed streaming, **play-only player**, 3-track-per-artist cap with ownership-checked delete. On-by-default for new artist profiles. **This is live and working end-to-end as of 2026-06-28.**
- **Founding-member infrastructure** (inherited from Kamooni; counter, badge, cap).
- Circles, messaging, reviews, noticeboards — inherited Circles primitives, present but not all Peerify-tailored yet.
- **Events module — substantially Peerify-tailored as of 2026-08-20**, no longer just the inherited Circles primitive. Draft → review → publish flow with a visible draft-status badge; multi-artist support (additional bands with delegated edit access); optional "Ticketed event" toggle (informational Price/Currency/Payment-info only — no real payment processing yet, see §00 payments milestone); a "private/home event" toggle (hides exact venue, approximate-area-only map placement, approval-required access); progressive-disclosure create form (Images/Artists/Virtual/Capacity/Recurring collapsed under "More options", Visibility/Noticeboard-sharing always visible); a "preview as a fan would see it" link using the real anonymous-visitor sanitizer; virtual events correctly surfaced on the map feed. An event's host circle is no longer fixed at creation — the creator can change it afterward (instant if they administer the target circle, otherwise a pending request the target circle's admins approve), with tasks/comment-feed migrating to the new host and stale URLs redirecting. Personal (non-artist/venue) profiles now get the Events module enabled by default like venues already did. Full detail: `SESSION_LOG.md`, 2026-08-14 (multi-artist) and 2026-08-20 (everything else above) entries.
- **Advanced Filters / category-aware search — as of 2026-08-27.** The Explore map's Advanced Filters panel (Genre, Physical-events-only, Calendar date range) now also has a real multi-select **Category** filter (Artists/Venues/Events, plus an "Other" catch-all for personal profiles/projects/posts), backed by a `selectedCategories: string[]` array rather than the old single-value model — any combination can be active at once, both via the top pills and the Advanced Filters checkbox card, kept in sync with each other. Desktop and mobile results lists are both sectioned by category (mobile drawer previously only ever surfaced Events through a separate, disconnected panel). Full detail: `SESSION_LOG.md`, 2026-08-26/27 entry ("Category-aware search Phase 2, plus two Clear-all fixes").
- **Personal-profile settings cleaned up**: the "Peerify Artist Profile" section (checkbox + all artist metadata fields) removed from the personal-profile About settings page. Replaced with a calm amber info banner ("This is your personal profile… use the + Create button") with a persistent localStorage dismiss. Artist/band/venue creation continues via the Create button flow — settings page no longer suggests otherwise.
- **Peerify-branded default avatars live**: `default-user-picture.png`, `default-artist-avatar.png`, `default-band-avatar.png`, `default-venue-avatar.png` replaced with Peerify orange-on-dark 512×512 versions (~32–52 KB, pngquant-optimized, down from ~1.6 MB each).
- **Venue/event feature-icon tags — as of 2026-08-28.** Fixed-enum tags (Age, Alcohol, Food, Seating, Setting, Accessibility, Venue type) on Circles (`defaultEventTags`, editable in Circle settings) and Events (snapshotted from the circle at creation, independently overridable per event via a collapsible picker on the edit page). Read-only icon+caption badges render on the event detail page, timeline card, and mobile map-panel row. Full detail: `SESSION_LOG.md`, 2026-08-28 entry.
- **Artist settings page cleanup — as of 2026-08-30, promoted to production 2026-09-01.** Circle→Profile rename in Draft/Publish copy for managed identities; the Published-status card now hides entirely once published, with a minimal "Draft — not visible to others yet" copy for the simple one-way publish flow; a second Save Changes button after Genre selection; Booking enquiries split into its own collapsible card; Spotify added to Music Links (settings + public profile); "Looking for/Open to" hidden (confirmed dead code, no public-facing renderer). Full detail: `SESSION_LOG.md`, 2026-08-30 and 2026-09-01 entries.
- **Pledge Dashboard restructure — as of 2026-08-30/31, promoted to production 2026-09-01.** Rebuilt around a pledge-first list instead of forced location clustering; locations with 3+ pledges promote into expandable Momentum cards; in-place per-pledge messaging with a "Messaged" indicator derived from real DM threads; the non-functional Map toggle removed entirely; currency code shown next to the amount on every pledge row. Pledge dialog's "Contribute to tour" section renamed/pruned (Attend removed, Host renamed, capacity as a conditional reveal field); Pledge/Crew buttons made visually consistent everywhere (orange for Pledge, solid ink-fill for Crew). Full detail: `SESSION_LOG.md`, 2026-08-30/2026-09-01 entries.
- **Multi-pledge duplicate fix + orphaned-pledge handling — as of 2026-08-30/2026-09-01, promoted to production.** Repeat pledges from the same fan now upsert on `(artistCircleId, pledgerDid)` instead of creating duplicates, backed by a DB-level unique index; existing duplicates reconciled on staging and prod, every group reviewed before writing. Pledges from since-deleted fan accounts now render greyed out and struck-through, excluded from aggregate stats, with a scoped admin Remove action — never a general delete-any-pledge capability. Full detail: `SESSION_LOG.md`, 2026-08-30/2026-09-01 entries.
- **Currency coherence pass — as of 2026-09-01, promoted to production.** Pledge currency is now genuinely fan-selected (upgraded to the compact `LocationPicker`), defaulted from the pledge location's country via a new country→currency table — decoupled from the artist's own booking-settings currency, which is untouched. Currency conversion and any single blended cross-currency total remain explicitly deferred. Full detail: `SESSION_LOG.md`, 2026-09-01 entry.
- **Crew Dashboard — new admin overview page, as of 2026-09-01, promoted to production.** Member cards (avatar, location, join date, offerings as icon badges reusing `CrewOffersWidget` styling, an explicit "general standing offer, not tour-specific" caption) with a Message action reusing the Pledge Dashboard's own DM pattern. Map view and per-artist offering customization explicitly deferred, same reasoning as the Pledge Dashboard's own map deferral. Full detail: `SESSION_LOG.md`, 2026-09-01 entry.
- **Self-pledge/self-crew-application guard — as of 2026-09-01, promoted to production.** A circle's own admin could previously pledge to, or apply to the Crew of, their own artist profile — no UI gating and no server-side guard existed. Fixed on three independently-verified fronts: profile-page buttons, the map-popup card, and the underlying server actions (`createPeerifyPledgeAction`, `applyForCrewMembership`) themselves, so a direct action call can't bypass a hidden button either. Two pre-existing self-pledges cleaned up; a legitimate pre-existing admin+crew-member overlap deliberately left untouched. Full detail: `SESSION_LOG.md`, 2026-09-01 entry.

### Infrastructure reality (important — supersedes older notes, updated 2026-11-02)
- **Servers (Cleura):** staging runs on `peerify-staging`, and prod runs on its own server, `peerify-prod`. Each server runs one app. Kamooni is a *separate* machine (`ubuntu@91.123.202.241`) — never cross commands.
- **Old box retired:** the Hetzner box (`tim@peerify`, 65.21.91.96, later called `peerify-old`) ran prod and staging side by side under `~/apps/...`. It's unreachable and being retired, so don't connect to it. SESSION_LOG entries before 2026-11-02 describe it.
- **Prod now (2026-11-02):** `0c637397` (= staging `8ab88b39`), deployed by Tim. Pre-release backup on `peerify-prod`: `/home/tim/backups/mongo-prod-20261102T151723Z` (rollback point `03249c6d`; **delete by 2026-12-02**).
- **Post-cutover follow-ups (plan adjusted 2026-11-02).** The cutover runbook itself is on Tim's side. Since 2026-11-02 the old box is unreachable to Tim too: SSH hangs after connecting, and its nginx doesn't answer. Tim has asked the hosting provider.
  - **48-hour step, from Tue 2026-11-03 09:54 CET.** It's split in two:
    - **Goes ahead:** remove `cutover-realip.conf` on Cleura prod and on Cleura staging. It doesn't depend on the old box.
    - **Waits for the old box:** its "has moved" page and nginx switch.
    - Caveat: if the old box comes back still forwarding, every forwarded visitor reaches Cleura from one IP once the real-IP config is gone, and they'd share the per-IP limits. So do the "has moved" switch first thing when it's reachable.
  - **7-day items on the old box (Sun 2026-11-08):** wait for the old box to be reachable. This includes the end of the 7 days the old data stays untouched. The data simply stays there longer.
  - **Not tied to the box:** remove the old box's SSH key from the `akrobatim` GitHub account (GitHub settings).
- **Runtime:** bare-Node via PM2, NOT Docker (the repo Dockerfile exists but isn't used to deploy). On each Cleura server the app runs from `/srv/peerify/app/circles` as the `peerify` user, with its env in `/srv/peerify/env/app.env` (secret, never read). PM2 `peerify` :3000 on prod, `peerify-staging` :3001 on staging.
- **Working copy (Claude):** `~/work/peerify` on `peerify-staging`, branch `staging`. Never edit `/srv/peerify`. Tim deploys. See `CLAUDE.md`.
- **Deploy:** `deploy-staging.sh` / `scripts/deploy-peerify.sh` pick their paths by hostname and do an atomic release via `scripts/deploy-common.sh`: `bun install --frozen-lockfile`, build, copy `public/` and `.next/static` into the standalone folder, then a PM2 restart with only the app's env (`pm2_with_app_env`, under `env -i`). A plain `bun run build` + `pm2 restart` misses the asset copy. A successful restart is not proof the deploy is correct, so verify the rendered page.
- **Repo:** standalone `Social-Systems-Lab/peerify`. HTTPS via nginx + Certbot. ffmpeg is a host dependency; set `FFMPEG_PATH` explicitly.
- **Golden rules:** confirm `hostname`/`pwd`/`git branch` before acting; staging before prod; one step at a time; review every diff; no autonomous git/infra changes; destructive commands as single standalone pastes.
- **History:** prod went down twice on the old box when a stray `PORT` in the shell leaked through `pm2 restart --update-env` (see the 2026-06-30 and 2026-10-10 SESSION_LOG entries). The deploy scripts now start PM2 with only the app's env.

### Design vs built — the gap ledger
| Surface | Design state | Build state |
|---|---|---|
| Landing page | mockup + integrated | **Built**; needs live artist/member/venue counts wired to DB |
| Artist profile | mockup v5 | **Built**; needs Peerify-tailoring (hide Kamooni-isms, side-panel UI changes — see Roadmap) |
| Fan profile | mockup v3 | partial (inherited Circles profile) |
| Music/upload/player | — | **Built + live** |
| Pledge | mockup (map popup, venue row, artist widget) | **Simple feature built**; needs refining |
| Map / Discover | mockup v2 | **Simple version built**; needs refining |
| Venue profile | mockup v1 (Bukowski) | not built |
| Host profile | not designed | not built |
| Payments (music sales) | — | **not built — targeted rudimentary by August** |
| Peerify Player | designed (§7 below as "the Player") | **deferred — needs resources we don't have yet** |

---

## §00. Roadmap

*The single place to track direction between sessions. Horizons, not hard dates, except where noted.*

### Milestone: artist onboarding (target 2026-07-15)
**Definition of done:** an artist can sign up → create a profile → upload tracks, and a fan can discover → play → pledge → book/contact the artist. **Clean, easy-to-understand UI with all Kamooni-specific or Kamooni-unique surfaces removed or hidden.** Minimum friction for both artists and fans creating profiles.

Concrete work toward it:
- **De-Kamooni the UI.** Hide (not necessarily delete — may be useful later) features that don't belong in Peerify or read as Kamooni-specific. Example: "verified contributions" on the profile page → hide. Audit profile + nav for other Kamooni-isms.
- **Artist side-panel UI changes** + how artists appear/present (details to define in-session).
- **Profile creation flow** — minimal-confusion path for artists *and* fans.
- **Landing page** — wire the artist / member / venue counters to real DB numbers.
- **Pledge** — refine the existing simple feature toward the designed mechanic (signal-not-escrow, contribution suggestion, contributor list; group-formation at 10% is later).
- **Map / Discover** — refine the existing simple version (real basemap, marker system per §4.6/§6, popup polish).
- **Book / Contact artist** — ensure the enquiry/contact path works end-to-end.

### Next: payments (rudimentary by 2026-08)
- Wire up a **payment portal to sell music** (digital file delivery + ownership tracking + the 90/10 commission model). Rudimentary is fine for August.
- **Tickets** sales follow music (later in the payments track).

### Campaign: crowdfunding launch (2026-09)
- Goal: raise **≥ €10,000** (hopefully well more) to take the prototype to **version one**.
- Purpose: spread the word, onboard more users/artists, attract sponsors/partners to cover dev + ops.
- Implication for the roadmap: the milestone + payments work above is effectively *campaign-readiness* — the platform needs to look credible and let a visitor actually sign up, hear music, and support an artist by September.

### Later (post-campaign / resource-dependent)
- **Peerify Player** (the native listening app + listening-data ingestion for dividends) — significant build, deferred until funded.
- **Venue + Host profiles**, venue-owner view, tour-team / group-formation flow, customisation UI, mobile-optimised patterns, alternate discovery views (Calendar/List), advanced search. (All designed or partially designed in §1–§11 below.)

### Carry-forward ops cleanup (next working session)

**✅ RESOLVED (2026-07-01, commit `6c30ad88`) — artist/band music-links Card restored**, gated on `isPeerifyManagedArtistCircle` only (personal profiles correctly keep the amber banner, no Card), Spotify removed. Verified rendering + data round-trip on staging (:3001). See `SESSION_LOG.md` 2026-07-01 entry.

**✅ RESOLVED (2026-07-01) — staging→main promotion complete.** Merged staging into main (merge commit `1f26690f`), prod rebuilt, PORT-safe restart, `pm2 save`. Verified live on peerify.one. Prod, staging, and main are now in sync. See 2026-07-01 `SESSION_LOG.md` entry.

Remaining carry-forward:

1. **Audit and remove inherited Kamooni/Cleura/Circles docs.** The repo carries
   stale docs from the Circles fork that describe a DIFFERENT platform on a
   DIFFERENT host (e.g. the Kamooni-flavoured `SESSION_LOG.md` lineage,
   `docs/cleura_deployment.md`, `docs/circles-deployment.md`,
   `docs/circles-registry-deployment.md`, and the root `deploy-genesis2.sh`
   Kamooni/Docker script). These are actively misleading. Process: inventory
   `docs/` with previews, triage each into {Kamooni-specific → remove,
   Circles-generic-still-useful → keep, Peerify-current → keep}, then `git rm`
   in one reviewable commit. Do NOT bulk-delete.
2. **Songwriter managed-identity type** — add constant `PEERIFY_DEFAULT_SONGWRITER_AVATAR_URL`, wire into `getPeerifyDefaultAvatarUrl()`, identity-type list, and Create flow. Optimized avatar prepared, not yet in repo.
3. **`default-profile-avatar.png`** (`public/peerify/`) un-optimized at ~1.6 MB — run pngquant.
4. **Banner flash-on-reload** — localStorage-gated banners (personal-profile + Verify Profile) flash one frame before `useEffect` hides them. Fix consistently: mounted-guard pattern or server-side preference.
5. **`canEditPeerifyArtistProfile` dead-const cleanup (now safe)** — the music-links Card it used to gate has been restored (commit `6c30ad88`, correctly gated on `isPeerifyManagedArtistCircle` alone). The old `canEditPeerifyArtistProfile` const in `about-settings-form.tsx` is now genuinely dead and can be removed in a separate cleanup session, along with general artist-settings polish. (Previously this item warned NOT to remove it, since it was evidence of the missing form — that regression is resolved; see 2026-07-01 `SESSION_LOG.md`.)
6. **Personal profile still renders circle chrome** ("Manage your circle's profile…", Pages / User Groups / Access Rules / Follow Requests) — de-Kamooni audit, separate task.
7. **`kam-yellow` / `kam-hero-yellow` color tokens** — Kamooni-named; rename to brand-neutral in palette overhaul.
8. **Over-broad `circles/` gitignore rule** (`circles/.gitignore` ~line 61) — matches `src/components/modules/circles/`; anchor or scope it.
9. **`*.bak` avatar backups** on staging + prod — delete now that prod is confirmed stable.
10. **Socials icon frame on public profile** — never built.
11. **`isVerified` overloaded for map/search discoverability** (discovered 2026-07-05). `isVerified` is meant to represent "account approved/activated by an admin" (set via `activateUserAccount()`, triggered by the admin "Verify Account" action or approving a verification request). However, this same flag is also the sole gate determining whether a personal/individual (`circleType: "user"`) profile appears in map results and search/discovery (see `isDiscoverableCircle`, `src/lib/data/search.ts:46-47`, and the identical `$or` clause in `getSwipeCircles`, `circle.ts:173`). This means any fan account an admin approves automatically becomes map-visible, regardless of `isPublic`, location precision, or explicit user choice. `isPublic` does not gate discovery at all currently — it only affects follow-approval requirements. Confirmed via prod DB query 2026-07-05: 5 of 9 `circleType: "user"` docs have `isVerified: true` (all pre-launch test/dev accounts, not real users), and all 5 have location coordinates set, so all 5 currently produce map pins. Not urgent pre-launch (no real users onboarded yet), but must be fixed before onboarding real fans, since it silently violates the stated MVP principle that only Artists/Venues/Events should be discoverable on the map for now. Proposed direction for a future session: decouple discovery visibility from `isVerified` into its own explicit field, and design a real visibility/discoverability setting individual users can control themselves (tie-in with the Access & Permissions card work from the 2026-07-05 Settings cleanup session). **⚠️ Escalated 2026-07-08:** `isVerified` for personal profiles now sets automatically as soon as a fan adds a profile picture + About text (see item 16) — no admin gate at all anymore. This makes the map/search leak in this item far more likely to trigger for real users very soon after onboarding (previously only 5 pre-launch test accounts had `isVerified: true` via manual admin action; going forward, most real fans who complete their profile will trip it within their first session). Fixing this decoupling is now materially more urgent, not just a pre-launch nice-to-have.
16. **isVerified auto-verify overhaul for personal profiles (2026-07-08, staging only, not yet promoted to main).** Replaced the admin-approval-gated `isVerified`/`accountStatus` flow with an automatic one, personal (`circleType: "user"`) profiles only — artist/venue verification untouched. `updateCircle()` (`src/lib/data/circle.ts`) now auto-verifies a personal profile the moment it has both a custom profile picture and non-empty About text (reusing the existing `getVerificationReadiness()` checklist), forward-only (never revokes on later edits). This directly unblocks posting/commenting/messaging, which are gated on `isVerified` via `needsToBeVerified` (previously required an admin to manually approve every fan before they could interact with anything). Also: hid the manual "Request Verification" UI for personal profiles specifically (`VerifyAccountButton`, `VerificationSettingsCard` — commented out, not deleted; artist/venue verification queue/UI untouched); added a shared explainer banner (`UNVERIFIED_PROFILE_EXPLAINER`) wherever posting/commenting/chat is blocked for an unverified user; added a one-time "profile complete" notification on the auto-verify transition (reuses the existing `sendUserVerifiedNotification`, new optional `messageBody` param); fixed a duplicate "Save Changes" button on the personal-profile About Settings page (a shared `renderSaveButton()` section-checkpoint helper was firing unconditionally in 3 places that render adjacent to each other for personal profiles specifically). Committed to `staging` (`08dc5fd7`) and pushed. **✅ Item 17's open issues investigated and resolved 2026-07-09** (commit `b072270a`, staging, pushed + deployed) — see below. Still not yet merged to `main`/deployed to prod; staging is otherwise in good shape for that promotion whenever it's scheduled.
17. **✅ RESOLVED 2026-07-09 — open issues from 2026-07-08 manual browser testing of the item-16 work.** Investigated all four; root cause for the two "not visible"/"not working" reports was **test-account state, not a rendering bug**: a live staging-DB query found 7 of 8 personal test accounts had already auto-verified (same-day timestamps as the 07-08 testing session) — the accounts were verified *before* the blocked-state UI was actually exercised, since picture+about had been saved first to set up a realistic test profile. Real bugs found and fixed along the way (commit `b072270a`):
    - **Stale "Request Verification" welcome-popup copy** — lived in `src/components/modules/home/home-content.tsx` (the end-of-signup `Dialog`, personal-profiles-only via the `isOwnUserProfile`/`circleType === "user"` guard). Replaced with copy describing the new auto-verify unlock mechanic. Confirmed this popup is not shared with artist/band/venue onboarding (same `HomeContent` component, but the dialog itself only ever opens for `circleType: "user"`).
    - **Real bug: mission/description write-path mismatch.** The Home tab's inline "click-to-edit" About field (`home-content.tsx`) wrote to `circle.mission` instead of `circle.description` whenever `description` was empty — but `getVerificationReadiness()`/`hasAboutText()` (`src/lib/verification-readiness.ts`) only ever reads `description`/`content`, never `mission`. A user completing their About text via that inline field (rather than Settings) could have visibly-saved text that silently never counted toward auto-verification. Fixed by always writing `description` for personal profiles specifically (`id={isUser || circle.description ? "description" : "mission"}`) — scoped to `isUser` only after an audit confirmed `mission` is still a live, separately-displayed field for regular community/org circles (Settings input + AboutPage "Mission" section + swipe-card/content-preview quote boxes), so an unscoped fix would have silently orphaned their mission content.
    - **Banner consistency cleanup:** `post-form.tsx` was checking a raw `!user.isVerified` instead of the shared `canPerformRestrictedAction()`/`isVerifiedUser()` helpers used everywhere else (skipped the admin bypass; latent inconsistency, not confirmed as live-exploitable). `CommentSection.tsx`'s nested reply composer had no verification banner at all (only the top-level new-comment composer did) — added one.
    - **Admin-messaging check** (`getRestrictedActionMessage("contact circle admins")` in `mongo-actions.ts`) was confirmed correctly wired to the same `isVerified`/`verificationStatus` vocabulary as posting/commenting, with a fresh DB read (not stale session/JWT data) and checking the sender's own DID (not the admin's) — the "still blocked" report was a test-sequencing artifact, not a code bug, though it remains an architecturally separate code path from `isAuthorized()`/`needsToBeVerified` worth eventually consolidating.
    - **Verification method:** full browser E2E (Playwright) was attempted but blocked by missing system shared libraries for headless Chromium (`libnspr4.so` etc., needs `sudo apt`) — declined rather than install. Fell back to exercising the real production functions (`updateCircle()`, `isAuthorized()`, `canPerformRestrictedAction()`, `getRestrictedActionMessage()`) directly against a throwaway account on the staging DB, mimicking exact real-signup defaults: confirmed a genuinely fresh/unverified account is blocked from posting/commenting/admin-contact; reproduced the mission-field bug live (writing About text to `mission` does NOT auto-verify even with a picture set); confirmed the fix (writing to `description`) DOES auto-verify and unblocks all three gates. Throwaway doc deleted after.
12. **Bug: public Booking card shows base fee with no currency unit** (resolved 2026-07-06). 
13. **13. (Downgraded, was: "currency not selectable" — incorrect) Currency field has no validation.** Verified 2026-07-06: the Currency field on Booking settings is already free-text and artist-editable (confirmed working end-to-end — value saves and displays correctly on the public Booking card, e.g. "ZAR 5000"). No feature work needed. Remaining minor polish: field has no validation against a known currency list, so typos or malformed entries (lowercase, extra characters, empty) are possible. Low priority — consider constraining to a dropdown/select from a standard currency list in a future polish pass.
14. **Feature (bigger, roadmap): location-based/tiered booking fees.** An artist may want to charge a different base fee for the same type of gig depending on the market (e.g. more for a house show in Berlin than in Bangkok). This ties into the broader booking-logistics redesign already flagged above — the Minimum/Preferred audience size and Needs accommodation/transport/meal fields were removed from Booking settings (commit `cc8614ce`, 2026-07-06) specifically because they were too broad pending this kind of tiered-fee rethink. Proper design work (tiers by region/market, UI for managing them) is needed before building this.
15. **Rotate staging `MINIO_ROOT_PASSWORD`** — flagged as exposed in a prior session; rotation status unconfirmed as of 2026-07-06. Verify and rotate if not already done.
18. **Distance-tiered pledge needs (Tier 3, not yet scoped, 2026-09-01).** Explicitly flagged as needing a combined design session with item 14 above (location-based/tiered booking fees) — not to be scoped independently of it.
19. **"My Pledges" personal fan-inventory page (not yet scoped, 2026-09-01).** A page listing a fan's own pledges across artists, comparable in spirit to the artist-facing Pledge Dashboard but for the fan's own side. Not yet scoped.
20. **Currency conversion / blended cross-currency totals (deferred, 2026-09-01).** The currency coherence pass (fan-selected pledge currency, per-currency subtotals and per-row display) deliberately stopped short of real exchange-rate conversion or a single blended total across currencies — both explicitly out of scope for that work, not yet scoped as their own feature.
21. **Unified Explore-style map showing pledges + Crew together (deferred, 2026-09-01).** Mentioned alongside the Crew Dashboard v1 build — that build deliberately shipped without a map view (same reasoning as the Pledge Dashboard's own map deferral); a combined pledges+Crew map view remains a future possibility, not yet scoped.
22. **Investigate the staging→main cherry-pick backlog (2026-09-03, predates this session).** A number of commits appear to exist on `staging` that were never cherry-picked to `main` — this predates tonight's work, not something introduced by it. Needs reconciling: confirm whether `main`/prod is actually missing real shipped features, or whether equivalent work already landed on `main` under different commit hashes from earlier cherry-picks (content-identical but different SHAs is the norm for this workflow — every commit promoted tonight did exactly that, e.g. staging's `2cf7fba0` ↔ main's `a939aac5`). Not yet investigated; don't assume either direction without checking.
23. **Small cleanup: contact form reason dropdown logs a React "controlled to uncontrolled" console warning (2026-09-03).** `peerify-contact-dialog.tsx:44` — `defaultValues` sets `reason: undefined`, so the `Select`'s `value={field.value}` starts undefined and only becomes a string once the user picks one; React warns on that transition. Likely fix is defaulting to `""` instead of `undefined`, but not yet made — flagged, not fixed.
24. **Small cleanup: `/about` page 404s, including on client-side prefetch (`_rsc` request) (2026-09-03).** The landing-page footer links to `/about` (`peerify-landing-page.tsx:380`), but there is no `/about` route anywhere under `src/app` — confirmed via search, not just observed as a symptom. A full navigation would 404 outright; Next.js `Link` prefetching surfaces the same 404 earlier, on scroll-into-view, as an `_rsc` request. Investigate what the page should actually contain before adding the route — not yet fixed.
25. **Venue/host signup flow remains unscoped (2026-09-03).** "List a venue or space" (CTA row) and the "For Hosts & Venues" Roles-section card are intentionally hidden behind `SHOW_VENUE_SIGNUP = false` (`peerify-landing-page.tsx`, commit `3fbd7b4f`/`a9d582d0`) — `/signup/pilot` has no venue option, no dedicated route, and no `CreatePeerifyVenueDialog` wiring from the landing page. Re-enabling these needs that flow designed and built first, not just the flag flipped.

---

*(The product & design bible follows. §1–§11 below are the stable canonical vision and have not been rewritten — only the build-status and roadmap layers above are session-updated.)*

---
## 1. What Peerify is

**Peerify is a non-profit, community-powered music platform — a sibling to Kamooni on the same Circles foundation.** It replaces algorithmic streaming with a map of human beings making music. The thesis: an artist with 1,000 true fans should be able to make a living, and the bottleneck has always been infrastructure to enable direct relationships, fair economics, and viable micro-touring.

- **Owner:** Social Systems Foundation (non-profit, public benefit)
- **Sibling to:** Kamooni (same Circles codebase)
- **Pilot:** Cape Town
- **Current funding ask:** $20–30k (ultra-lean prototype, 4–5 months)
- **Domains:** **peerify.net** = HTML-based info/blog site (marketing, blogs, partner info). **peerify.one** = the app itself (the Circles-based platform). *(The older doc treated these as interchangeable; they are not.)*
- **Status:** Live MVP. Audio pipeline shipped to prod (see §0). Building toward the July-15 artist-onboarding milestone.

### The trio of core roles

A single account can hold multiple roles. Someone may be a fan, artist, host, or any combination. **Artist/band/venue profiles are created via the "Create" button** (NOT through the personal profile's Settings page — that route is confusing and is being removed; see §0/§00).

1. **Artists** — Make music, want to earn from it, willing to tour where supported.
2. **Fans/Supporters** — Buy music, pledge for tours, host shows, volunteer for tour teams.
3. **Venues/Hosts** — Physical spaces (commercial venues, homes) that host events. *These are two quite different sub-roles* — see 5.4.

---

## 2. The full set of problems Peerify solves

From the brand work, in narrative order:

1. **Discoverability without depth** — combines global artist discovery with local belonging.
2. **Loss of intimacy** — restores small rooms, real listening.
3. **Touring without safety nets** — pledge system enables risk-free micro-tours.
4. **Inadequate artist income** — multiple revenue streams, 90% to creator.
5. **Opaque algorithms** — open-source, user-driven discovery.
6. **Extractive business models** — non-profit, surplus returned to artists.
7. **Support that doesn't circulate** — fan membership credit goes back into the ecosystem.
8. **Fragmented music tools** — unifies discovery, sales, hosting, communication.
9. **Vanishing small venues** — every room becomes a viable micro-venue.
10. **Lack of trust for intimate events** — reviews, verification, private-event approval.
11. **Loss of music as social infrastructure** — restores shared civic experience.
12. **Artist sustainability collapse** — multiple revenue pillars.
13. **Algorithmic bias against non-viral genres** — community-curated, not click-ranked.
14. **Burnout and loneliness** — micro-communities, fan-clubs, circles.
15. **Travel/expansion difficulty** — pledge + community-hosting model.
16. **Fans want meaningful experiences but can't find them** — the map.
17. **Discovery lacks cultural context** — local scenes visible alongside artists.
18. **Artists don't own their audience** — direct, portable, lock-in-free.

### Tagline / brand voice
- "Peerify — The Next Stage of Music"
- "A peer-to-peer, non-profit ecosystem supporting small artists, local scenes, and a meaningful culture of listening."
- Manifesto: poetic and stirring, short-to-medium form. Vision: "restore music as a living, local, human experience." Mission: "empower artists to earn fairly, fans to connect deeply, communities to grow through intimate gatherings."

---

## 3. Mechanics — what we've decided

### 3.1 Commission

- **Music, tickets, fan-club fees: 10%** — Peerify invoices the artist after the fact. Payment is peer-to-peer.
- **Merchandise: 0%** — no commission on merch and vinyl.
- **VAT:** the artist's responsibility (not Peerify's).
- **Escrow:** Peerify does *not* hold pledged funds in escrow. Pledges are signals; when threshold is reached, pledgers confirm and pay the artist directly. Member-credit balances (the €4/month) *are* held by Peerify.

### 3.2 Pricing tiers

**Artists**
- Free tier (Community Artist): full profile, uploads, sales, gig listings, booking enquiries, basic supporter management. Genuinely usable.
- Pro tier (Artist): €2/month or €20/year. Unlocks video hosting, live broadcasts, segmented messaging, deeper analytics, expanded tour-planning tools.
- **First 1,000 artists free for 3 years** (Founding Artist program). Condition: minimum one social-media post per week marketing Peerify. After 3 years they pay the same as later artists.
- **Once an artist starts earning, their Pro subscription is deducted from the 10% commission as credit.** A successful artist effectively pays €0 for Pro.

**Fans/Members**
- Non-members: free, but see ads.
- Members: €5/month. **€4 of that is earmarked as the fan's music-purchase credit** (spendable within Peerify); €1 is the platform fee. Members get governance rights, no ads, enhanced trust, partner discounts.
- Founding members: paid only — no free founding members for fans. Membership #1–#1,000 get a recognised badge.

**Venues**
- No membership fee for MVP. Ticket commission only (10%).
- Per the Bar Bukowski mockup: venue absorbs the 10% rather than passing it to the artist. Worth keeping as a brand promise.
- A paid tier may come later when we know what features venues actually want.

**Advertising**
- Ads run for non-members only. Members get an entirely ad-free experience.
- The Artist Primer line "No advertising" should be updated to "no advertising for members."

### 3.3 Surplus distribution

- **Currently undecided, leaning toward 50/50.** Half of platform surplus returned directly to artists as dividends; half retained by the Foundation to fund Peerify, Kamooni, and other community projects.
- Dividend mechanic: based on Peerify Player listening data + plays at Peerify-organised live events. Plays from non-members or lapsed-member accounts don't count toward dividend calculations.
- Live-event plays may be weighted 20–50× standard plays.

### 3.4 The pledge mechanic

The core USP of Peerify. Two flavours:

- **Fan-initiated**: "Bring [Artist] to my city." Fans accumulate pledges; threshold = artist's travel costs + minimum fee.
- **Host-initiated**: "I'll host [Artist] in my living room." Host sets capacity, threshold = artist's set fee, pledges function as pre-sold tickets.

**Distance-aware contribution suggestion**: each pledger sees a suggested amount based on (transport cost) + (artist minimum fee) ÷ (target audience size). Can override.

**A pledge is a signal, not a payment.** Once threshold is reached, pledgers are invited to confirm and pay the artist directly. Peerify never holds the money.

**Group formation at 10% threshold.** When a pledge campaign hits 10% of goal, Peerify initiates a tour-team group and invites pledgers to take on a Tour Manager role to push the remaining 90%. This is a *social mechanic* — pledgers meet each other and bring the show into being together.

**Pledge-in-progress shows appear on venue calendars.** The Bukowski mockup puts a "PLEDGE IN PROGRESS · 57% FUNDED" entry directly in the upcoming-shows list, with an orange-tinted card, an inline pledge bar, and a "Pledge here" CTA. The held date is contingent on the campaign tipping. This is the venue's view of the same campaign that lives on the map and on the artist page.

### 3.5 Privacy model (fans)

**Private by default. Granular per-item visibility.** Each piece of profile info has its own audience:

- Anyone (open public)
- Logged-in Peerify members
- People at the same event as you
- Tour team members for a tour you're on
- Explicit contacts (people you've accepted)
- Just you

Three presets in the UI:
- **Strict** (everything contacts-only, default)
- **Open** (more visible to fellow members)
- **Public** (broadly visible)
- Custom (advanced)

**Public preview** = a deliberately limited view (symbolic avatar, no name/face, aggregate stats). Strangers see a calm business card; contacts see the real Marcus. No "ghost mode" feel — just calm by design.

**Contacts grow organically** through sharing songs via the Player, attending events, and explicit accept flows.

### 3.6 Tour offerings (the volunteer/host system)

Fans list what they can offer to touring artists — entirely opt-in, hidden from the rest of Peerify, visible only to matched tour teams:

- Spare bedroom
- Local transport
- Meals / cooking
- City knowledge
- Promotion help
- Venue introduction
- Photography/video
- Equipment loan

**Tour coordination** = lightweight task management inside Peerify (a tour event has a team + tasks + a comment thread). For complex tours, a tour manager can "promote" coordination into a Kamooni circle for full project management.

### 3.7 The Peerify Player

The listening heart of the ecosystem. Not a streaming app. **NOTE: deferred — a later project requiring resources not currently available (see §00 Roadmap).**

- Unique Player ID per installation
- Plays Peerify-format files only (purchased music)
- Each play counts toward dividend calculations
- **Ethical sharing**: two players in close proximity + artist consent + degree limits (e.g., 3 hops max from original purchase)
- **Gifting**: send playlists; sender purchases songs for recipient
- **Direct tipping**: 0% commission, listener-to-artist
- **Live-event plays weighted 20–50×** standard plays
- **Optional listener visibility**: opt-in to artists (top listeners, geographic spread)
- Song-level marginalia, time-stamped notes, non-competitive reactions
- "Listening With" mode: synchronized listening across distance
- Mobile apps (Android, iOS) planned

---

## 4. Visual design system

### 4.1 Brand identity

- **Logo:** orange location-pin shape with concentric broadcast rings and central figure. Recognisable, recolourable, used as the platform mark.
- **Wordmark:** "Peerify" in Cormorant Garamond 500.

### 4.2 Color system

```
--pf-ink:           #1A1612    warm near-black
--pf-cream:         #F2EBDB    page background (parchment)
--pf-paper:         #FAF6EC    card background
--pf-paper-light:   #FDFAF3    lightest paper (sub-sections)
--pf-line:          #DFD5BF    borders, dividers
--pf-line-soft:     #ECE3CC    softer dividers
--pf-muted:         #7D7164    secondary text
--pf-orange:        #E8732C    Peerify functional accent
--pf-orange-soft:   #F1A674    soft variant
--pf-orange-tint:   #F8E2CE    very light tint (badges, hovers)
--pf-sage:          #506B56    event-marker accent
```

*(Note: the live landing page currently uses main orange `#e8720c` / hover `#ff8c2a`. The palette above is the fuller design-system spec; old mustard values should be replaced where still visible. Reconcile during UI cleanup.)*

### 4.3 Typography

- **Display:** Cormorant Garamond (400, 500, italic 400/500/600). Used for headings, names, taglines, eyebrows.
- **Body:** Manrope (300–700). Used for paragraphs, UI labels, metadata.
- *Italic is a real semantic device* — used for taglines, eyebrows, footers, soft emphasis. Not decoration.

### 4.4 Three visual languages on one page

A consistent rule across the system:

- **Artist content** (their own page surfaces, their messaging, their music) uses **their chosen accent colour** (sage green for Lerato Khoza).
- **Venue content** uses **its chosen accent colour** with more restraint than artists get (Bar Bukowski: deep burgundy `#6B2E2E`). Same customisation system, smaller curated palette, more business-card energy than artist-as-performer energy.
- **Peerify mechanics** (pledge widgets, buy buttons, commission notes, founding badges, verification marks, "Book this room" widgets) always use **Peerify orange**.

Orange belongs to the platform doing its work; the role-holder's colour belongs to them.

**Fans don't customise.** Fan pages use the Peerify default palette (orange functional, ink accents). The platform protects; the artists and venues shine.

### 4.5 Page architecture

Standard layout pattern across role pages:

```
[Topbar — dark ink, full width, sticky]
[Hero or page-header — atmospheric (artist, venue) or calm (fan)]
[Profile-bar — pills, meta, actions; avatar straddles boundary]
[Section nav — tabs in italic display font, sticky under topbar]
[Main grid — content (1fr) + sidebar (380px)]
[Strip(s) — dark sections for platform-mechanics like upcoming/past shows]
[Reviews section — verified, role-appropriate]
[Footer — dark ink]
```

The map page departs from this — it's the centrepiece treatment (see 6.1). Profile-style pages share the skeleton above.

### 4.6 Marker system (for the map) — revised in Map v2

**All markers are Peerify pins.** The shape is the same across the board; differentiation is by **colour, size, label, and aura**. This was a deliberate change from the v1 plan (which used photo bubbles for artists, squares for hosts, rectangles for venues). The unified shape:

- avoids a surveillance-y "photos of strangers on a map" feel
- gives the platform a single recognisable map vocabulary
- lets the popup do the work of revealing identity

Variants:

- **Artist** — orange Peerify pin, with name label below
- **Pledge campaign** — orange Peerify pin with percentage label ("Lerato · 57%") and, if featured, a **soft pulsing aura**. Featured = viewer-personal (a pledge the viewer has personally pledged to).
- **Event** — sage-tinted Peerify pin, with date label ("14 Mar")
- **Venue** — deep-orange Peerify pin, with venue name label ("HKW Berlin")
- **Host** — cream/outlined Peerify pin, **no label** (hosts anonymous-until-matched)
- **Fan** — small dark Peerify pin, calm and private (used sparingly; see open question in §6)
- **Cluster** — pill with city name + count ("12 in London"), used at zoom-out

### 4.7 The Peerify pin as universal mark

The logo isn't just for the topbar. It appears at multiple scales as the *verification mark*:

- "[pin] 23 verified reviews" on album hero
- "[pin] Verified" badge in reviewer cards
- "[pin] PEERIFY PLEDGE" eyebrow on pledge widgets
- "[pin] verified buyer / verified attendee / verified host / verified artist" in user reviews
- "[pin] PEERIFY BOOKING" eyebrow on venue "Book this room" widget
- "[pin] FOR TOURING ARTISTS" eyebrow on venue terms grid

The pin says *this happened on Peerify, we can vouch for it*.

---

## 5. Mockups built (design phase — see §0 for what's actually coded)

All HTML files self-contained. **Newer mockups embed images as base64 data URIs** (atmospheric warm gradient placeholders with italic initials for portraits) — see 7.7 for the technique. This makes the files fully portable; recipients on any network see the design as intended.

### 5.1 Artist profile — v5 (Lerato Khoza)
**File:** `peerify-artist-profile-v5.html`

Lerato Khoza, folk-soul singer-songwriter from Cape Town. Founding artist #47. Subject's chosen palette: deep moss green accent, Cormorant Garamond italic display, warm parchment background. Cover photo + 240px circular portrait overlapping into parchment. Page anatomy:

- Hero (atmospheric, dark with cover image, name + tagline only)
- Profile-bar (pills, meta with **187 supporters**, action buttons: Pledge/Book/Follow/Tip)
- Tabs: About · Music · Shows · Fan Club · Merch · Updates · Reviews
- Main: Latest release (with verified-review rating), songs list, "What listeners say" verified review cards, bio
- Sidebar: Pledge widget (Berlin/London cities), Book widget, Quick facts, Elsewhere links
- Upcoming Shows strip (dark, three event-card types: public/house/pledge-in-progress)

Key decisions baked in:
- **Followers → "supporters"** (only people who've actually spent money count)
- **Verified reviews** with the Peerify pin as authenticity mark
- **Per-track ratings** inline
- **90% to artist** transparency note next to buy buttons
- Hero text in upper-middle, avatar at lower-left straddling boundary (no overlap with name/subtitle)

### 5.2 Fan profile — v3 (Marcus Voss)
**File:** `peerify-fan-profile-v3.html`

Marcus Voss, Berlin-based patron and tour-team volunteer. Founding member #312. Owner's view (Marcus logged in, viewing his own profile). Visual treatment quieter than artist's — Peerify default theme, no per-user customisation, calm paper-coloured header, no big atmospheric cover image. Fans aren't on display.

Section nav: Overview · Messages · Feed · Supporting · Circles · Reviews · Library · Tour team · Events · Contributions · Settings. Sidebar includes Founding member #312, recent contributions timeline, privacy-by-default matrix, and "what strangers see" symbolic avatar.

### 5.3 Discover/Map — v1 (superseded by v2)
**File:** `peerify-discover-map-v1.html` — first pass, two-pane split. Superseded.

### 5.4 Discover/Map — v2
**File:** `peerify-discover-map-v2.html` (images embedded). Centrepiece treatment per §6. The map IS the page. Floating filter bar, view toggle (Map/Calendar/List), right-slide results panel, markers across Europe centred on Berlin, horizontal quick-preview popup. Basemap is still a stylised SVG placeholder; real Mapbox swap-in is its own task.

### 5.5 Venue profile — v1 (Bar Bukowski)
**File:** `peerify-venue-profile-v1.html` (images embedded). Bar Bukowski, an 80-seat jazz listening room in Kreuzberg, Berlin. Founding venue #12. Deep burgundy `#6B2E2E`. Calendar tab built out (incl. a pledge-in-progress row), "what artists can expect" terms grid, dual-source reviews (artists vs listeners), past-shows strip. Other tabs (About, Past shows, The space, For artists, Contact) still need content layouts.

---

## 6. Map v2 — what was decided and built (design)

### 6.1 Map is the *centrepiece*
The map IS the page, not a panel within a layout. Other panels (filters, results, popups) **float over the map**. Airbnb-style but more committed: map fills the viewport, UI elements layer on top with backdrop blur.

### 6.2 Discovery hierarchy
**Artists across the globe is the primary discovery mode.** Not pledges, not events. We want people **discovering artists they didn't know existed** and then choosing to support them directly (buy / follow / pledge).

### 6.3 Pill order — settled
**All · Artists · Events · Offerings · Venues · Pledges** (All default; Artists first; Pledges last/deprioritised; Offerings = the volunteer-marketplace side).

### 6.4 Quick-preview popup — horizontal layout
Marker click opens a small popup over the map (400px × ~210px). Dark eyebrow bar (pin + campaign label + % funded), image left with centred play button, body right (name, location, pledge widget, two CTAs). **Click → hear → decide.** Full artist page is a deliberate next step.

### 6.5 Follow/Notify-me (softer than pledge)
**Notify me when [Artist] plays within [Y] km** — a watchlist commitment level between passive browsing and active pledge. Feeds demand signal without requiring money or organising.

### 6.6 Group formation at 10% pledge threshold
At 10% of goal, Peerify auto-initiates a group (circle-shaped object) and invites pledgers; someone can volunteer as Tour Manager; the group works toward the remaining 90%; once funded, the group becomes the tour team. A **social mechanic** as much as logistical.

### 6.7 Still to do on the map
Real Mapbox basemap; marker clustering at zoom-out; featured-pledge pulse logic (viewer-personal); host privacy at zoom (city-zoom-or-wider only, or location-jitter); **open question: should fans appear as map pins at all?** (deferred).

Advanced search (Category/Genre/Physical-events-only/Calendar) is now built — see §0 and `SESSION_LOG.md` 2026-08-26/27.

---

## 7. Decided patterns worth keeping in working memory

### 7.1 Founding artist mechanics
Reuses Kamooni's founding-member system (counter, window-open toggle, cap, revocation path). New wrinkle: the **weekly social post requirement** for the 3-year free window — new engineering (compliance check, grace period, admin surfacing). Not in the Kamooni system.

### 7.2 Naming
- **"Map" stays** as the nav label (not "Discover"). Distinctive — most platforms have Discover; few have a map.
- "Followers" → **"Supporters"** (people who've spent money).

### 7.3 Verified reviews — two dimensions on venue pages
Artist-page reviews come from listeners (verified buyer/attendee). Venue-page reviews come from **two audiences** with a toggle: **From artists** (who played there — pay, room, audience attention, treatment) and **From listeners** (atmosphere, programming, value). Same Peerify-pin verification mark. No anonymous reviews. N=5 minimum to display aggregate ratings.

### 7.4 Customisation
- **Artists choose** accent colour, display font (curated set of ~6–8 pairings), cover photo, tagline.
- **Venues choose** the same from a more restrained curated palette.
- **Fans don't customise.** Default symbolic avatar (initials in a Peerify-warm circle).

### 7.5 Per-role page-component patterns (cross-reference for porting)

| Pattern | Used on | Notes |
|---|---|---|
| Atmospheric hero + cover photo | artist, venue | Fans get a calm paper header |
| Avatar straddling hero boundary | artist, venue | Fans don't (contained) |
| Profile-bar with pills + meta + actions | all three | Same skeleton, role-specific pills |
| Tabbed section nav (italic display) | all three | Tab list varies per role |
| Main + 380px sidebar grid | artist, venue | Fan uses single-column |
| Pledge widget (orange) | artist sidebar, map popup, venue calendar row | Always orange; always Peerify mechanic |
| "What artists can expect" terms grid | venue | Orange six-cell grid; venue's transparency promise |
| Dark mechanism strip | artist (upcoming shows), venue (past nights) | Same chrome, opposite time direction |
| House-rule callout (dark, single italic) | venue | Personality declaration |
| Reviews section with toggle | venue (artists vs listeners) | Dual-source on venue |
| Press-quote block (burgundy left rule) | venue | Reusable on artist pages |

### 7.6 Pledge-in-progress show treatment
When a campaign is mid-funding and a date is held at a venue, the calendar shows a **distinct card variant**: orange-tinted bg, orange date number, "PLEDGE IN PROGRESS · X% FUNDED" eyebrow, inline pledge bar + meta, "Pledge here" + "Notify me" CTAs, "held date pending pledge confirmation" note. Same campaign appears on three surfaces (map pin, artist sidebar, venue calendar) — one canonical pledge object.

### 7.7 Embedded-image technique (for mockup portability)
Standalone HTML mockups embed images rather than reference external URLs. The generator (`gen_placeholders.py`) produces atmospheric warm-gradient placeholders with film grain + italic initials, deterministic per seed (~30KB/image, JPEG q78). Placeholders signal "mockup" honestly while staying on-brand; swap real photos in one-for-one when they arrive.

---

## 8. Design backlog (consolidated into §00 Roadmap)

*The original "still to design" list now lives in the §00 Roadmap with proper horizons. Kept here for the detailed design notes:*

- **Pledge campaign page** — the transaction surface the map sends people to (threshold mechanic, contribution suggestion, contributor list, 10% group-formation invitation).
- **Group formation / Tour Manager onboarding** — the 10%-threshold conversion flow.
- **Host profile** — distinct from venue; private individual offering their home; closer to the fan pattern (private-by-default, symbolic avatar, no public discoverability until matched).
- **Venue owner view** — Marc & Lisa managing Bukowski (calendar editor, booking-enquiry inbox, revenue dashboard).
- **Mobile patterns** — especially the map (touch markers, popup positioning, bottom sheet vs floating).
- **Customisation UI** — font/colour/cover picker (+ venue restraint controls).
- **Player UI** — the listening experience (separate app, deferred).
- **Onboarding flows, discovery views (Calendar/List), search results, other venue tabs.**

---

## 9. Open questions to revisit

- **Surplus split percentage** (50/50 between artists and Foundation? Or different?)
- **Whether to require human verification (KYC-lite)** for any roles (ALTCHA now gives a basic human tier; deeper verification TBD).
- **What "Founding Member" means for fans** beyond a numbered badge (any perks?)
- **Tour coordination split**: simple Peerify-native tasks vs. full Kamooni promotion — at what complexity does it cross over?
- **Whether fan-club posts appear in the public Overview feed.**
- **Whether public artist ratings show on profiles or only on individual works.**
- **Whether fans should appear as map pins at all** (deferred from Map v2).
- **Whether the "what artists can expect" grid is the right venue commitment**, or a separate "For artists" page.

---

## 10. What's shared with Kamooni (Circles primitives reused)

Inherited from Circles, usually with minor tweaks: Accounts/auth, Circles (fan clubs, thematic/private circles), Events (extended with Peerify event types), Members (extended with role types), Founding-member system (+ social-post compliance check), Noticeboards/posts (the Feed), Goals/Tasks (lightweight tour coordination), Messages, Reviews (extended with verification marks + venue dual-source), Settings/visibility (extended for granular privacy).

**Net-new in Peerify (not in Kamooni):** the Pledge object; the Offerings object; the Peerify Player; the map-based discovery layer; music-sales infrastructure (file delivery, format conversion, ownership tracking); ticket-sales infrastructure; the 90/10 commission ledger; verification marks; music-credit balance system (€4/month earmarking); venue calendar with pledge-in-progress variant; the "what artists can expect" venue terms object.

**De-Kamooni note:** the UI still surfaces Kamooni-specific or Kamooni-unique features that should be hidden (not necessarily deleted) for Peerify — e.g. "verified contributions" on profiles. This is an open-ended audit tracked in §00.

---

## 11. Concrete build notes (salvaged from prior repo checkpoints)

### Landing page implementation
- `src/app/page.tsx`, `src/app/welcome/page.tsx`
- `src/components/pages/peerify-landing-page.tsx` + `.css`
- Uses a temporary fixed-overlay CSS approach to bypass the inherited Circles app shell on public routes. Works visually; a future cleanup should split public pages from app-shell pages properly.
- **TODO:** wire the artist / member / venue counters to real DB numbers.

### Assets
- Peerify assets in `public/peerify/`. Logo `/peerify/logo-mark.png`, favicon `/peerify/favicon.ico`.
- Landing images: everyone.jpg, fans.jpg, artist.jpg, hosts.jpg, about.jpg, contact.jpg, involved.jpg.

### Auth/session
- Now served over HTTPS → `CIRCLES_COOKIE_SECURE=true` (the earlier HTTP-pilot `false` is resolved).

### Onboarding routes (early)
- `/signup/pilot`, `/signup/pilot/check-email`, `/onboarding/peerify?intent=fan|artist|host` exist as the first role-choice screens. (Note: the profile-creation flow is being reworked to go via "Create" — see §00.)

### Snapshots
- `~/peerify-snapshots/peerify-onboarding-auth-working-20260608-0916.tar.gz` (+ a later landing snapshot). These were on the old Hetzner box and are gone with it.

## Repository & Branch Reference (updated 2026-11-02)

- Peerify's code lives at `Social-Systems-Lab/peerify` on GitHub (moved out of the shared `circles` repo on 2026-06-24). The old `product/peerify` branch in `Social-Systems-Lab/circles` is history only (tag `archive/product-peerify-final`).
- `staging` → Cleura staging, `main` → prod (peerify.one). Prod is never ahead of `main`.
- **Staging work:** commit in `~/work/peerify` on `peerify-staging`, push to `origin staging` (never `main`). Tim deploys staging.
- **Promotion to prod:** Tim's call, with an explicit go-ahead for every step (see `CLAUDE.md`, Deploy Safety). Tim deploys on `peerify-prod`.
- **Since 2026-11-02, `main` contains `staging`.** The release commit `0c637397` is a sync merge: its tree is exactly staging `8ab88b39`, with parents `03249c6d` (old main) and `8ab88b39`. So the next release is a fast-forward of `main` to a tested staging commit. No more cherry-picks. Before that, `main` was built from cherry-picks, so older staging and main SHAs differ for the same change.
- **Who can push `main`:** only Tim, from his Mac (`~/peerify-release`, key `~/.ssh/id_ed25519_github`, the account on the ruleset's bypass list; a push prints "Bypassed rule violations"). The GitHub key on `peerify-staging` gets `GH013 Cannot update this protected ref`, so Claude prepares the commands and Tim runs them.
