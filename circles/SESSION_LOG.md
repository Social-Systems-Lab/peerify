# Peerify — Session Log

Live at: https://peerify.one  ·  Staging: https://staging.peerify.one
(This log was migrated from the Kamooni/Circles repo during the 2026-06 split; entries before ~June 2026 describe Kamooni lineage and shared Circles work.)

## Current Status (2026-06-28)
- Production: https://peerify.one — live, HTTPS (nginx + Certbot), PM2 process `peerify` on :3000, branch `main` @ 116e9394.
- Staging:    https://staging.peerify.one — live, isolated, PM2 process `peerify-staging` on :3001.
- Audio pipeline: LIVE on prod (MP3 upload → ffmpeg derivative → signed streaming → play-only player). ffmpeg resolved via host /usr/bin/ffmpeg; prod .env.local sets FFMPEG_PATH explicitly.
- Build tool: bun. Runtime: Next.js standalone via PM2 (not Docker).
- **ORPHANED-CIRCLES ISSUE — Phase 0 fix deployed to staging (see 2026-08-02 (cont. 6) entry
  below), Phase 1/2 still open, ALSO STILL LIVE IN PRODUCTION:** deleting a personal account
  (admin dashboard or self-service — both call the identical `deleteCircle()`) never touches
  circles that account created/administers, and silently strips that account's own admin
  membership from those circles as a side effect of unrelated member-count-drift cleanup —
  bypassing the existing "cannot remove the last admin" safeguard (`removeMemberAction`),
  which never runs on this path. **Phase 0 (this staging-only fix): both deletion entry
  points now BLOCK the deletion outright** if the account is the sole admin of any circle,
  naming the affected circle(s) — no new orphaning can happen going forward on staging.
  **Still open:** production has not been touched (byte-identical gap still live there); the
  17 circles already orphaned on staging before this fix are untouched (Phase 1); no
  reclaim/discovery-hiding/formal-orphan-state work has been done (Phase 2). Do not consider
  this issue closed until Phase 1/2 are addressed or explicitly descoped, and until the
  Phase 0 fix itself is deployed to production.
- **PRODUCT CHANGE (2026-08-02, deployed to staging):** personal-profile participation
  (posting/commenting/messaging) now requires Community Guidelines acceptance in addition to
  picture + About text — see dated entry below. `getVerificationReadiness` is the single
  source of truth for this; do not add a separate guidelines check elsewhere.
- **OPERATIONAL HAZARD (see 2026-08-02 (cont. 3) incident below):** running a bare
  `bun run build`/`CI=1 bun run build` in this worktree AFTER a real deploy has happened will
  silently corrupt the live standalone build (Next.js regenerates `.next/standalone` from
  scratch, wiping the static assets a prior `deploy-staging.sh` run copied in, without
  restarting PM2 to match) — site-wide breakage, not specific to whatever was being verified.
  Verification builds are fine standalone; just always follow one with a real
  `deploy-staging.sh` run before trusting staging is in a consistent, servable state again.
  Resolved as of 2026-08-02 (cont. 4)'s own follow-up deploy — a real `deploy-staging.sh` run
  was requested and completed (all 8 steps passed, chunk-resolution re-verified via curl
  post-deploy), so staging is back in sync with `staging` HEAD as of that deploy.
- See OPERATIONS.md for full architecture and deploy procedure.

---

## 2026-08-04 (cont. 4) — Decoupled map search scope from the active filter pill

Headline: fixed the map search silently getting pre-scoped by whichever content-type pill was
active (including the Artists default), causing a search for a friend/venue to return zero
results with no indication why. One commit (`277eba2a`), one file changed
(`map-explorer.tsx`), local to `staging` only, not deployed.

**Investigation first, as instructed.** Found where the pill couples into search:
`filteredSearchResults` (`map-explorer.tsx`) filters `allSearchResults` by `selectedCategory`
before anything else runs — with Artists as the now-default pill, EVERY fresh search
immediately excluded venues. Separately, the search panel's "items" display (used in two
places — a panel-sync effect and inside `handleSearchTrigger` itself) only ever showed events
when `selectedCategory === "events"` exactly, excluding events from search results for every
other pill state (including the default). The **default (no-search) browsing view uses a
different code path** (`baseCircles` = `filterCirclesByCategory(allDiscoverableCircles,
selectedCategory)` directly, not through search state at all) — confirming the pill's role as
"default view filter" and "search pre-scope" were coupled only through `selectedCategory` being
read in both places, not through shared logic that needed disentangling elsewhere.

**Fix:** on the transition into a *fresh* search (`!hasSearched` at call time — not on a
refinement of an already-active search, e.g. a genre pill change, so a pill still works as a
post-search narrowing tool rather than getting silently reset out from under a search already
in progress), reset `selectedCategory` to `null` before computing results. Generalized the
"items" display logic into a shared `searchDisplayItems` memo (plus an equivalent local
computation inside `handleSearchTrigger` for that same-tick closure, since the memo's inputs
wouldn't yet reflect the just-fetched results within the same synchronous execution): with no
pill exclusively active, search results now span every content type — circles of every identity
plus matching events — rather than only whichever type the leftover pill happened to select.
`baseCircles`/`filterCirclesByCategory`'s own logic, and their use for the default browsing
view, are completely unchanged.

**Verification:** no browser tooling available, so verified via a fixture-based script (not
committed) using the real `isPeerifyArtistIdentity`/`isPeerifyVenueIdentity` functions,
mirroring the exact new logic: a venue-matching search with the Artists pill active returns the
venue; an artist-matching search with the Venues pill active returns the artist; a search
already in progress keeps a subsequently-applied pill's narrowing (not reset by a genre-change
refinement); and the default Artists-pill browsing view (calling `filterCirclesByCategory`
directly, the unchanged code path) is unaffected. `bun run lint` and `npx tsc --noEmit -p .`
both clean — only one new, pre-existing-pattern-unrelated warning surfaced in the whole lint
run, confirmed to be a shifted line number for an already-existing, untouched effect further
down the file.

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `ZjhEeMeo7E3O182RqhCl9`), prod pid/uptime unchanged. `/explore` curl-verified to
render fully post-deploy (76KB, zero "Application error" occurrences).

**Carry-forward:** this fix is pure client-side React state/effects logic with no
server-executed code path, so unlike the event-visibility fixes there's no way to exercise the
actual search-scoping behavior via curl even now that it's deployed — the fixture-based script
run before deploying remains the most rigorous verification available. Still needs a real
click-through (typing a query, watching results populate) in an actual browser to confirm the
live UX matches this logical verification.

---

## 2026-08-04 (cont. 3) — Hid Topics from chat/messages UI — not needed for Peerify

Headline: investigated then hid the chat "Topics" feature from the UI, per request. One commit
(`2b448ef1`), two files changed, local to `staging` only, not deployed.

**Investigation first, as instructed.** Topics turned out to be real, Peerify-built
functionality — not leftover Kamooni/Circles scaffolding. No dedicated Mongo collection or
model in `src/models/models.ts`; it's implemented as `thread`/`threadId` fields directly on
`ChatMessageDoc` (`src/lib/chat/mongo-types.ts`), with full CRUD in `mongo-chat.ts`
(`createThread`, `fetchThreadReplies`, `listThreadsForConversation`, ...) and server actions in
`mongo-actions.ts` (`createThreadAction`, `sendThreadReplyAction` — which fires real chat
notifications). Wired into unread-count logic too (`app/chat/layout.tsx` explicitly accounts
for topic replies). Three user-facing surfaces, all in `src/components/modules/chat/`: the
composer's "New topic" lightbulb button + `NewThreadModal` (`chat-room.tsx`), an inline
green-tinted "Topic card" replacing the normal bubble for topic-starter messages
(`chat-room.tsx`), and a "Topics" tab in the room's Info dialog (`group-settings-modal.tsx`,
`ThreadsTab`). Confirmed via full-repo case-insensitive search: **fully self-contained within
the chat module** — nothing in circles/forums/discussions/notifications references it.

**Decision, explicit and confirmed with the user rather than assumed:** since Topics isn't
entangled with other modules, the hide-vs-remove tradeoff wasn't about breaking other features
— it was about whether to also delete the real, functioning backend. Chose **UI-only hide**:
backend (`mongo-actions.ts`, `mongo-chat.ts`, `mongo-types.ts`) completely untouched, so any
existing topic data and the notification/unread-count integration stay intact and this remains
easily reversible. Confirmed zero topic-starter messages exist on staging currently, so no
existing content is actually affected either way at this moment.

**Fix:** removed/gated the three UI entry points without deleting the underlying component
definitions — the "New topic" button (its modal and state left in place, now unreachable), the
inline TopicCard branch (topic-starter messages now render through the same normal-bubble path
as any other message; `TopicCard` itself left defined, just unused), and the "Topics" tab
(`ThreadsTab` and chat-room.tsx's `OPEN_TOPIC_EVENT` listener left in place, unreachable).
Removed the two artifacts my own edit made genuinely dead in `group-settings-modal.tsx` (an
unused `HiLightBulb` import and a local `OPEN_TOPIC_EVENT` constant — chat-room.tsx has its own
independent copy of that same string, untouched).

**Verification:** no browser tooling available, and deploying wasn't authorized for this task,
so verified via a full grep sweep (no visible "Topic" text remains reachable in either changed
file — remaining matches are all inside the now-unreachable definitions, or the unrelated
Matrix protocol field `m.room.topic`) plus `bun run lint` and `npx tsc --noEmit -p .`, both
clean. Deliberately did not run a build — staging's live standalone build would be corrupted by
a bare build without an immediate redeploy (the standing operational hazard), and this task
explicitly said not to deploy without checking first.

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `-r7gE08dU4aWKhl1pZh88`), prod pid/uptime unchanged. Post-deploy, hit the live chat
room page directly (minted JWT, real session, real conversation `6a40ec0a1b387a97b3cd8410`) —
page rendered fully (68.7KB, zero "Application error" occurrences), the conversation's own
content ("Welcome to Peerify") still present confirming the room loads correctly, and zero
matches anywhere in the rendered output for "New topic", "Topic title", "Create Topic", or a
"Topics" tab label. Real end-to-end confirmation (not just code-level analysis) that Topics is
gone and the conversation itself is unaffected.

**Carry-forward:** still not interactively tested — no browser tooling available in this
environment, so send/receive itself (as opposed to page load) hasn't been clicked through live.
Unaffected by construction (no server action or data-access code was touched), but that's
inference, not an interactive confirmation.

---

## 2026-08-04 (cont. 2) — Fixed map filter-pill bugs: events leaked through Artists/Venues pills; defaulted map to Artists

Headline: two related bugs found while testing the just-promoted event-visibility fixes, but
confirmed unrelated to them. One commit (`284816d2`), one file changed
(`map-explorer.tsx`), local to `staging` only, not deployed.

**Bug 1 — selecting a content-type pill didn't actually filter the map.** Root cause: the
"Update map markers" effect (`map-explorer.tsx`, ~line 800) only exclusively displayed one
content type when `selectedCategory === "events"`. For every other value — including
`"users"` (Artists) and `"communities"` (Venues) — it fell through to a default branch that
unconditionally appended `filteredEventsForMap` on top of the already-correctly-filtered
circles. `baseCircles` (via `filterCirclesByCategory`) was always narrowed correctly; events
just always leaked through regardless of which pill was active. Confirmed this has nothing to
do with the visibility-gating fixes promoted earlier today (`6efd8066`/`7f8bdb14`) — those
govern whether content should ever appear on the map at all; this bug is purely about the
client combining two already-correct datasets incorrectly.

**Bug 2 — map should default to Artists selected, not everyone.** `selectedCategory`
initialized to `null` (no filter/"everyone"). Changed to `"users"`. This depended on Bug 1's
fix — defaulting to Artists without it would still have shown every event alongside artists on
load.

**Fix:** only combine circles with events when no category pill is active at all
(`selectedCategory` null/falsy) — a circle-type pill now excludes every other content type, not
just other circle types. Both bugs share the same state variable and the same effect, so one
commit.

**Verification:** no browser tooling available in this environment, so verified via (1) a full
manual trace of the new code against all four `selectedCategory` states (null, `"users"`,
`"communities"`, `"events"`), and (2) a throwaway script (not committed) that imported the real
`isPeerifyArtistIdentity`/`isPeerifyVenueIdentity` functions and mirrored the exact fixed
combination formula against representative artist/venue/event fixtures — all four states
produced exactly the expected content-type set. `bun run lint` and `npx tsc --noEmit -p .` both
clean (no bare build; not deploying this session).

**Carry-forward:** not deployed — local to `staging` only, per instruction. Needs a real
click-through on staging once deployed to confirm the actual UI (pill highlighting, map
markers) matches this logical verification.

---

## 2026-08-04 — Fixed map event-visibility bug: events ignored their host circle's own privacy gate

Headline: investigated and fixed a scoped map visibility bug — events shown on the map never
checked their host circle's own visibility, only the event's own `visibility` field. One commit
(`6efd8066`), one file changed (`src/lib/data/event.ts`), deployed to staging only.

**Root cause.** Compared how circles/profiles vs. events are gated for the map:
- Circles (`getSwipeCircles`, `circle.ts:217`): must pass `getPublishedCircleQuery()`
  (`publishStatus: "published"` or missing), and personal ("user"-type) profiles additionally
  require an explicit `mapVisible: true` opt-in (defaults to `false`).
- Events (`getOpenEventsForMap`, `event.ts:1225`): only checked the event's own `visibility`
  field (public/private) plus creator/RSVP/invite overrides. Zero references to
  `publishStatus`/`mapVisible`/`isPublic` anywhere in `event.ts` — the host circle's own
  visibility was never consulted at all.

**Confirmed exploitable**, not just theoretical — called the real, unmodified
`getOpenEventsForMap` directly against two constructed test cases (staging DB, cleaned up
after): a public/open event hosted by a draft (unpublished) circle leaked onto the map, and one
hosted by a personal profile with `mapVisible: false` (explicitly opted out) also leaked,
bypassing that account's own privacy choice. A background research agent's independent findings
(after stalling for ~19 minutes before finally completing) corroborated this precisely, plus one
extra detail: `map.tsx`'s client-side defense-in-depth check (`isSuppressedUserProfile`) covers
circles but has no event equivalent either.

**Fix.** Added a host-circle lookup-based `$match` stage to `getOpenEventsForMap`'s aggregation,
mirroring `getSwipeCircles`' exact rule: the host circle must be published, and if it's a
personal profile, must also have `mapVisible: true`. A missing host circle (e.g. deleted) now
fails closed. The two extra fields (`publishStatus`, `circleType`, `mapVisible`) added to the
circle lookup's own projection are `$unset` immediately after the gating match, so the
client-facing `circle` shape on `EventDisplay` is unchanged — confirmed empirically (hit a real
MongoDB quirk here: `$set`/`$addFields` reassigning an existing document-valued field with a new
document expression *merges* rather than replaces, confirmed via isolated aggregation tests;
`$unset` on the specific sub-fields avoided the quirk entirely).

**Verification:** re-ran the same two leak test cases post-fix — both now correctly excluded — plus
a third positive-control case (event hosted by a genuinely published circle) to confirm nothing
else regressed and the returned `circle` shape is unchanged. `bun run lint` clean. Build verified
via `deploy-staging.sh` only (no bare build), which also deployed the fix to staging — all 8
steps passed, prod untouched.

**Scope note, explicitly not fixed:** `getOpenEventsForList` (`event.ts:1454`, the list/panel
view, not the map) has the identical gap — same visibility-gating stage, same missing host-circle
check. Left untouched since this task's remit was the map specifically; worth its own scoped fix
later, reusing this exact pattern.

---

## 2026-08-04 (cont.) — Closed the flagged getOpenEventsForList gap: same fix as the map, its own commit

Headline: applied the identical host-circle visibility fix to `getOpenEventsForList`
(`event.ts:1454`, the list/panel view) — the gap explicitly flagged, but left out of scope, in
the map fix above. One commit (`7f8bdb14`), one file changed, deployed to staging only.

**Fix:** same host-circle lookup-based `$match` stage as `getOpenEventsForMap`'s fix
(`6efd8066`/`1f5575a2`) — host circle must be published, and if a personal profile, must also
have `mapVisible: true`. Same `$unset` of the gating-only projection fields immediately after, so
`circle`'s client-facing shape on `EventDisplay` is unchanged.

**Verification:** same three test cases as the map fix (constructed against the real,
unmodified `getOpenEventsForList`, cleaned up after) — draft-circle event and
`mapVisible: false`-profile event both correctly excluded; a published-circle control event
still shown with an unchanged `circle` shape. `bun run lint` clean, only the one file changed.
Build verified via `deploy-staging.sh` only — all 8 steps passed, prod untouched.

No remaining known gap between circles/profiles and events for map-adjacent visibility (map +
list). Not checked: search (events aren't part of the text-search path per the earlier
investigation, so not applicable), and any other event-surfacing view not covered by this task's
remit.

---

## 2026-08-03 (cont.) — Retest investigation: fix confirmed working; found (and fixed) a misleading "profile complete" notification, a deliberate design divergence, not a bug

Headline: a retest of the Continue-setup fix below appeared to fail (still routed to
"Personal Profile — Step 1 of 4"). Investigated before touching anything, per instruction.
The fix is fine; the retest account's personal phase genuinely wasn't complete. That in turn
surfaced a real, separate piece of user-facing confusion, now fixed.

**Retest investigation — fix confirmed correct, not stale:**
1. Verified the deploy wasn't stale: local and nested standalone `BUILD_ID` matched
   (`jHdE4BKZ2ITp5x20I6rjM`), and grepping the actual deployed bundle
   (`.next/static/chunks/app/circles/[handle]/layout-*.js`) found the real fixed code live —
   `onClick:()=>{K.push("/onboarding/pilot"),K.refresh()}` — no `<Link>`/anchor remaining.
2. Confirmed no duplicate/second "Continue setup" button exists anywhere else that could still
   be using the old `<Link>`-based navigation — only one other literal occurrence in the whole
   source tree, an unrelated fan-branch button inside the flow itself.
3. Identified the retest account (`hello-test`, created 2026-08-03T08:39 UTC — the only account
   anywhere near that recent; everything else is 8+ days old) and checked its real DB state:
   picture ✓, About text ✓, Community Guidelines ✓, but **`location` was never set** (`undefined`,
   not just a default). `hasLocationSet()` requires `location.lngLat` with finite lat/lng —
   fails outright for this account.
4. Confirmed directly via curl (minted JWT, real session) against the live server: this
   account's `/onboarding/pilot` genuinely and correctly returns "Personal profile — Step 1 of
   4" — matching the retest's "failure" exactly, but as correct behavior given the account's
   real state, not a caching bug recurring. The Location step's "Skip" option looks identical
   to completing it, and appears to be what actually happened during the retest.

**Real finding, not the retest's premise:** the human got a "Your profile is complete! You can
now post, comment, and message on Peerify" notification despite never setting location — a
reasonable, direct cause of assuming location wasn't required and of the confusing retest.
Compared all three places this could matter:
- The notification's trigger (`updateCircle`'s auto-verify block, `circle.ts`) and the actual
  server-side post/comment/message permission gate (`canPerformRestrictedAction` → `isVerified`,
  set by that exact same trigger) are **the same flag** — no drift between these two. Both
  require picture + About text + Community Guidelines. **Not** location.
- `isPilotPersonalPhaseComplete` (the onboarding resume-routing check) requires all of the above
  **plus location** — and says so explicitly in its own file comment, which already documents
  location as deliberately excluded from the participation gate.

Unlike the Community Guidelines session's bug (an accidental missing-DB-projection defect),
this divergence is intentional and self-documented in the code — a genuinely different bar for
"can participate" vs. "onboarding flow's personal phase is done." Confirmed empirically against
`hello-test`'s real record: `isVerified: true`, `verifiedAt: 2026-08-03T08:40:36Z` (the instant
guidelines were accepted, the last of the three required fields) — notification fired, full
participation granted, location never touched.

**Decision (explicit, this session): keep the participation gate exactly as-is.** Location stays
genuinely optional for posting/commenting/messaging — not changing that. Only the notification
copy was misleading relative to the onboarding flow's own stricter "complete" definition, so
only the copy was fixed.

**Fix (`42e771c7`):** `updateCircle`'s auto-verify block now checks `hasLocationSet(c)` at the
moment it fires and picks between two messages — the fuller "Your profile is complete! You can
now post, comment, and message on Peerify." only when location is actually set, otherwise "You
can now post, comment, and message on Peerify!" (drops the "complete" claim, doesn't mention
location, just announces what's actually been unlocked). Also corrected
`participation-readiness.ts`'s stale file-header comment, which still said Community Guidelines
acceptance didn't affect this gate — that's been inaccurate since the Community Guidelines
session added it to `getVerificationReadiness`'s user branch.

**Verification:** `bun run lint` clean (same pre-existing warnings elsewhere, nothing new).
`CI=1 bun run build` clean (full build this time, as instructed — not immediately followed by a
deploy in this session, so staging's live standalone build is now out of sync with `staging`
HEAD pending a real `deploy-staging.sh` run, per the standing operational note).

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `EgpYDPyOxQW9eE4I9vX_z`), prod pid/uptime unchanged. Grepped the deployed server
bundle for both notification message variants to confirm they actually shipped (server-side
code isn't visible via the client-HTML curl trick used for the routing fix).

**Carry-forward:**
- Staging is deployed with both this notification-copy fix and the earlier Continue-setup
  routing fix (same build). Production has neither yet.
- The product question raised here — should `isPilotPersonalPhaseComplete` keep requiring
  location for onboarding-resume purposes even though participation never will — was answered
  for now (yes, keep both as they are); revisit only if this class of confusion recurs.

---

## 2026-08-03 — Artist Draft-profile banner's "Continue setup" misroute: CONFIRMED via real production signup, root cause found (client-side, not page.tsx)

Headline: the 2026-08-02 (cont. 4) "Fix 3" investigation below concluded this bug's premise
could not be confirmed. It was wrong — a real signup on **production** (peerify.one, not
staging) reproduced it cleanly. This session reproduced it first (as instructed, without
assuming the prior conclusion still held), found the actual root cause — which is NOT what
Fix 3 checked — and fixed it. Two commits, both local to `staging`, not deployed.

**Confirmed repro:** complete the shared/personal phase (Frames 1a-1d) on a fresh account,
proceed into the artist phase past Solo/Band selection (i.e. `saveArtistIdentityTypeAction`
has actually run at least once), then abandon before finishing. Visit the artist circle's own
page — its Draft-profile banner appears. Click **that banner's own** "Continue setup" (not the
personal Home tab's "Complete profile" banner, a separate, already-correctly-routed entry
point) — it lands on Frame 1a of the personal phase instead of resuming the artist phase, even
though the personal phase is already fully complete.

**Why Fix 3 missed it:** Fix 3 tested against `dave-knowles`'s real artist circle
(`dave-knowles-2`), which matched the reported scenario's *surface* description ("personal
phase complete, artist circle draft") but not its *actual* precondition — Dave's artist circle
had never been touched at all (`identityType: "artist"` — the untouched default,
`description: ""`, stock avatar). The bug specifically requires having progressed **past**
Solo/Band (i.e. `metadata.peerify.identityType` explicitly saved) before abandoning. Fix 3
never controlled for this variable, so its "already evaluates to the correct jump" finding was
true for the account it tested but didn't cover the account state the real report described.

**Root cause investigation, this session:**
1. Reproduced the exact precondition without a real signup (no browser tooling in this
   environment — see repeated note elsewhere in this log): patched `dave-knowles-2`'s
   `metadata.peerify.identityType` directly to simulate having actually run
   `saveArtistIdentityTypeAction` once, then abandoned (matching the reported repro exactly).
2. Called `page.tsx`'s own real, unmodified functions (`getAutoProvisionedArtistCircle`,
   `isPilotPersonalPhaseComplete`) directly via a throwaway script against the live staging DB
   — **result: correctly computed `initialStep: "artist-solo-band"`**. Confirmed
   `updateCircle`'s auto-verify block (the only other write-path side effect
   `saveArtistIdentityTypeAction` touches) only fires for `circleType === "user"`, never the
   artist circle — ruled out as a factor.
3. Not trusting a reimplementation alone: minted a real JWT for `dave-knowles`'s actual account
   (same secret/algorithm as `generateUserToken`) and hit the **live staging server directly**
   with `curl`, cookie included, for both the untouched and the patched-artist-circle DB
   states. Both returned the correct frame ("Welcome to your public artist profile setup", not
   "Add a photo"). Also confirmed the response header: `Cache-Control: private, no-cache,
   no-store, max-age=0, must-revalidate` — no HTTP/CDN caching involved.
4. **Conclusion: `page.tsx`'s resume-point logic is, and was, correct.** The bug is not a
   missing-wiring gap in the server-side "artist-phase-jump" logic at all (confirming Fix 3's
   narrower finding was right, as far as it tested) — it's that the banner's `<Link
   href="/onboarding/pilot">` is a client-side App Router soft-navigation, which curl cannot
   exercise. `/onboarding/pilot` has no distinguishing search params and no `loading.tsx`, so a
   navigation to it can resolve to a stale cached RSC payload/props from **earlier in the same
   browser session** — plausibly from right after signup, before the personal phase (or this
   artist phase) was actually complete — instead of triggering a fresh server round-trip. This
   specific banner is the likeliest of the three entry points to have been rendered, and thus
   navigated from, at that earliest, least-complete point (it's on the artist circle's own
   page, visible immediately after auto-provisioning at signup), which is why it manifests here
   without necessarily implicating the other two.

**Fix (`96cb4f37`):** replaced the plain `<Link>` in `home-content.tsx`'s Draft-profile banner
with `router.push("/onboarding/pilot"); router.refresh();` — the same idiom
`PilotOnboardingFlow`'s own `advanceStep` already uses to keep itself fresh after a save. This
doesn't touch or duplicate the (already-correct) `page.tsx` logic; it just forces that logic to
actually run against fresh data instead of a stale cached instance being reused. Did not touch
the other two entry points — no evidence they share the same failure mode in practice, and the
instruction scoped the fix to this banner.

**Copy (`30b18a95`):** on the artist-track explainer screen (`role-explainer-step.tsx`,
step `"explainer"`, artist branch) — bolded "public artist profile" in "Now let's set up your
**public artist profile**", and renamed its "Continue setup" button to "Continue with artist
setup" (singular "artist", matching the bolded text right above it). Left the fan branch's
identical-looking "Continue setup" button (leads into fan setup, not artist) unchanged.

**Verification:** `bun run lint` clean (only pre-existing warnings elsewhere). `npx tsc --noEmit
-p .` clean — used instead of a full `CI=1 bun run build` per this week's standing process note
(a bare build after a real deploy silently corrupts the live standalone build; not deploying
this session, so a full build wasn't run and staging's live process is unaffected/untouched).
Re-ran the same curl-based repro (patch `identityType` -> curl -> restore) after the fix to
reconfirm `page.tsx` is unchanged/correct; the fix itself is a client-side navigation change
that could not be exercised the same way (no browser tooling available) — its correctness rests
on `router.push` + `router.refresh()` being the identical, already-proven pattern this exact
component already relies on elsewhere. Dave Knowles' real account
(`metadata.peerify.identityType`) was restored to its original untouched value after testing.

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `jHdE4BKZ2ITp5x20I6rjM`), prod pid/uptime unchanged. Post-deploy curl re-check against
the freshly restarted staging process confirmed `/onboarding/pilot` still resumes at the artist
phase for the patched-`identityType` DB state — same result as pre-deploy, as expected since
the deploy only ships what was already verified, not a new server-side behavior change.

**Carry-forward:**
- Staging is deployed; production is not — the fix has not been promoted yet. Still needs a
  real click-through retest in an actual browser on staging before promoting (this session
  could only verify the server side and the fix's underlying idiom via curl, not live client
  navigation behavior — no browser tooling available in this environment).
- Worth a quick sweep of the other two "Continue setup"/"Complete profile" entry points
  (`community-participation-banner.tsx`, `community-participation-dialog.tsx`) for the same
  stale-soft-navigation risk if this class of bug resurfaces elsewhere — not done here since
  the instruction scoped this fix to the one banner and there's no evidence yet they're
  actually affected in practice.

---

## 2026-08-02 (cont. 6) — Orphaned-circles issue, Phase 0: block deletion that would orphan a circle

Headline: narrow, urgent safety fix for the gap the (cont. 5) investigation below found —
deliberately scoped to *just* stopping new orphaning, not the broader long-term handling
(formal orphan state, discovery hiding, reclaim flows). One commit, local to `staging` only,
not deployed. Explicitly framed here and in the commit as **Phase 0** of a three-phase plan:

- **Phase 0 (this entry): block deletion outright when it would orphan a circle.** Done.
- **Phase 1 (not started):** decide what to do with circles already orphaned (17 on staging
  as of the (cont. 5) investigation) and/or formalize an orphaned/unclaimed state.
- **Phase 2 (not started):** reclaim/ownership-verification flow for orphaned circles.

**Investigation, per instruction, before implementing:**
1. Confirmed the exact path again: `deleteCircle()`'s `otherMemberships` cleanup block
   (`src/lib/data/circle.ts`) strips the deleted did's membership from every circle it
   belongs to — a side effect of fixing member-count drift, not written with "does this
   orphan something" in mind. The existing "cannot remove the last admin" safeguard lives in
   `removeMemberAction` (`src/components/modules/members/actions.ts`): it checks
   `countAdmins(circleId) <= 1` before letting a single membership be removed. It doesn't run
   on the deletion path because deletion never calls `removeMemberAction` at all — `deleteCircle`
   does a raw batch `Members.deleteMany`, an entirely separate code path.
2. Checked whether that exact safeguard is directly reusable: it isn't, as-is — it's built
   around removing *one* membership from *one* circle for *one* target member (with its own
   authorization/access-level checks baked in), not "does deleting this did leave *any* circle
   it administers with zero admins." So implemented the "block before deletion begins" shape
   (option b from the task), reusing the underlying `countAdmins` function `removeMemberAction`
   itself is built on — same rule, new shared entry point (`getSoleAdminCircles`), rather than
   force-fitting the single-removal function into a different shape.

**Fix:**
- New `getSoleAdminCircles(did, excludeCircleId?)` in `src/lib/data/member.ts`: finds every
  circle where `did` is an admin, and returns the ones where `countAdmins(circleId) <= 1` —
  i.e. removing this did would leave zero admins. `excludeCircleId` skips the very circle
  being deleted (every personal circle has a self-membership row for its own did, confirmed
  via a real staging account — Dave Knowles' own personal circle has a Members row for
  itself — so without this, every deletion would incorrectly flag its own about-to-be-deleted
  circle as a "orphan").
- Wired into both entry points the investigation named:
  - `deleteCircleAction` (self-service, `circles/actions.ts`): blocks with a message naming
    the affected circle(s), checked before the confirmation-name comparison even runs.
  - `deleteEntity` (admin dashboard, `admin/actions.ts`): same check, same message; already
    surfaces via the existing `result.message` toast-on-failure handling already present in
    `users-tab.tsx`/`circles-tab.tsx`/`projects-tab.tsx` — confirmed by reading all three, no
    UI change needed there.
- Also surfaced proactively in `getCircleDeletionStatsAction` (already fetched the moment the
  delete dialog opens, per `DeleteCircleButton`'s existing `useEffect`) so the dialog shows a
  clear "Cannot delete yet" notice and disables the destructive button entirely — using the
  existing "type the circle's name to confirm" dialog as the integration point, per
  instruction, rather than only surfacing the block as an error after someone types the
  confirmation and clicks delete.

**Hand-traced against real staging data — read-only queries only, zero accounts/circles
modified (confirmed via `git status` before and after):**
- `dave-knowles`: 1 sole-admin circle (`dave-knowles-2`) after excluding its own personal
  circle — would correctly block, naming that one circle.
- `cryp-timothy`: 4 sole-admin circles (`The Bandy Band`, `The other one`, `McCool`,
  `My Circle dirkle`) — would correctly block, naming all four.
- `linus`: 2 sole-admin circles; `tim-admin`: 7 sole-admin circles — both would correctly
  block. (Did not attempt to actually delete any of these real accounts — traced the query
  logic directly against their real membership data instead.)
- No real account on current staging happens to have zero admin-memberships beyond its own
  circle (every remaining test account administers at least one other circle) — the "proceeds
  normally" case was verified by direct code-logic reasoning (empty result array → no block)
  rather than a live example, since none exists on staging right now to demonstrate it against.

**What this fix deliberately does NOT do (per instruction):** no cascade-delete, no
orphaned/unclaimed state or flag, no discovery/map/search hiding, no reclaim or
identity-verification flow, and the 17 circles already orphaned before this fix are left
exactly as they were — this only prevents new orphaning going forward.

**Verification:** `bun run lint` and `CI=1 bun run build` both clean.

**Aside:** hit the long-standing "over-broad `circles/` rule in `circles/.gitignore`" issue
from the 2026-06-30 session's carry-forward notes again — `git add` silently refused
`src/components/modules/circles/actions.ts` (an already-tracked file) until `-f`. Still
unfixed, still a live footgun for anyone touching files under that path; not fixed here
(out of scope for this task), but worth flagging again since it's now caused friction twice.

**Carry-forward:**
- Not deployed — 1 commit local to `staging` only, per instruction. Do not promote to
  production until this has been exercised on staging first (per instruction) — this changes
  account-deletion behavior, a sensitive path to get wrong.
- Phase 1 and Phase 2 (see above) are deliberately deferred, not forgotten — do not treat the
  orphaned-circles issue as resolved until a decision is made on those.
- Worth actually clicking through this on staging once browser tooling is available (or
  manually): confirm the dialog's blocking notice renders correctly and the destructive
  button is genuinely disabled, not just logically blocked server-side.

---

## 2026-08-02 (cont. 5) — Fixed a stale onboarding banner; investigated a serious orphaned-circles gap in account deletion (also live in production)

Headline: one small display-condition fix, plus a read-only investigation into a real
data-integrity gap that turned out to already be live in production, not staging-specific.
One commit for the fix; the investigation made no code changes, per instruction.

**Fix — "Step 1 complete — Continue to Step 2" banner outliving Step 2 (`a90978d2`).** Root
cause: `settings/about/page.tsx` fetched `ownAutoProvisionedArtistCircle` via
`getAutoProvisionedArtistCircle(userDid)` with no `publishStatus` filter at all — contradicting
that prop's own documented contract on `AboutSettingsForm` ("only passed down... while that
artist circle is still unpublished"). `getAutoProvisionedArtistCircle` itself deliberately
doesn't filter by publish status (other callers, e.g. `/onboarding/pilot`, need the circle
regardless of publish state), so this call site needed its own filter to honor its promise.
Fixed at both ends: `page.tsx` now only passes the prop while `publishStatus !== "published"`,
and `about-settings-form.tsx`'s `isArtistOnboarding` also checks this directly as defense in
depth. Once published, the component now falls through to the standard "This is your personal
profile" banner instead of the stale two-step framing — the artist circle's own page already
celebrates publication (the congrats modal from a prior session), so no new UI was needed.

**Investigation — orphaned public circles after account deletion. Read-only, no fixes
implemented, per instruction.**

1. **What does account deletion actually do?** Both the admin dashboard (`deleteEntity` in
   `admin/actions.ts`) and self-service deletion (`deleteCircleAction` in
   `circles/actions.ts`, reachable via the personal profile's own General settings —
   confirmed "general" is NOT in `settings-layout-wrapper.tsx`'s hidden-for-`isUser` nav list)
   call the exact same underlying `deleteCircle(circleId)` — byte-identical behavior, not two
   diverging implementations. That function deletes the target circle's own Members, feeds,
   posts, chat rooms, and vector-DB entries, plus (for a personal/`user` circle) the local
   filesystem user directory — but **never queries for circles the deleted account
   created/administers at all.** Worse than pure inaction, though: it removes the deleted
   account's own membership from *every other circle it belongs to* (a separate cleanup block,
   there specifically to fix a member-count-drift bug, not written with this scenario in mind)
   — which includes its own admin membership on any circle it created, since the creator is
   always added as a member at creation time. Net effect: the circle document survives fully
   intact and publicly visible, but is left with **zero member rows of any kind** — completely
   bypassing `removeMemberAction`'s existing "cannot remove the last admin" safeguard
   (`adminCount <= 1` check), which never runs on this path since it's a raw batch delete, not
   a call to `removeMemberAction`.

2. **Can circles have multiple admins?** Yes — genuinely, not just theoretically.
   `Members` has no uniqueness constraint limiting a circle to one admin; `updateUserGroupsAction`
   lets an existing admin promote another member to `"admins"`; there's even a full
   admin-role-removal-*request* workflow (`createAdminRoleRemovalRequest`/
   `approveAdminRoleRemovalRequestAction`/`declineAdminRoleRemovalRequestAction`) — real
   product surface built around multi-admin governance. In practice, though, none of the 19
   auto-provisioned artist circles on staging have more than the one creator/admin — every one
   of them is single-owner, so for this specific circle type, "creator's account deleted"
   and "zero surviving admins" are currently the same thing. Confirmed via direct query
   (0 circles found in an "some surviving members, zero surviving admins" intermediate state).

3. **Does an "orphaned"/"unclaimed" circle concept already exist?** No — confirmed via a
   repo-wide grep. The only "orphan"/"unclaimed" hits are unrelated (orphaned *shadow posts* in
   task/issue/proposal/goal modules; "Unclaimed" *shifts* in the tasks module). Nothing for
   circles at all.

4. **Does this diverge from production?** No. Read-only, byte-for-byte compared
   `deleteCircle()` in `~/apps/peerify-staging/circles/circles/src/lib/data/circle.ts` against
   `~/apps/peerify-app/circles/src/lib/data/circle.ts` (production, `main` branch) — identical,
   line for line, same comments. This is a pre-existing, already-live gap in production, not
   something newly relevant because of staging test-account churn. (Aside, not part of the
   app's runtime code: found a standalone `delete-user.ts` script at the production worktree's
   root that does a raw, single-document `deleteOne` with zero cascade cleanup at all — an
   even blunter tool, but a one-off admin script, not the app's actual deletion path.)

5. **Real orphan count on staging (queried directly, not estimated):** 19 auto-provisioned
   artist circles exist total (`metadata.peerify.autoProvisionedFromSignup: true`) — matches
   the report exactly. Of those, **17 have zero surviving members of any kind** (their
   creator's personal account no longer exists, confirmed against the 5 personal accounts
   currently on staging); only 2 have a surviving creator/admin. Across *all* non-user circles
   (34 total, including manually-created ones), two more zero-member circles exist but are
   unrelated to this same mechanism: "Kamooni" (the platform's own legacy default circle, has
   never had tracked members) and "Aritst artist" (an apparent abandoned test signup) — both
   noted for completeness, not counted in the 17.

**Proposed options (not implemented — pending direction):**
- **(a) Cascade-delete owned circles when their last admin's account is deleted.** Reuse the
  existing `countAdmins`/last-admin-check logic (`removeMemberAction` already has it) so a
  multi-admin circle only loses that one admin's membership, not the whole circle. Simplest,
  leaves no orphaned data. Tradeoff: destructive and irreversible — a circle with a real
  following, tracks, or history could vanish because its founder deleted their *personal*
  account for unrelated reasons, with no chance to reconsider.
- **(b) Mark the circle "unclaimed"/hidden-from-discovery when its last admin is deleted,
  with a reclaim path.** Keep the data, pull it from `/explore`/search/map (would touch
  `getSwipeCircles`/`DISCOVERY_CIRCLE_PROJECTION`/`search.ts` and similar query paths), and
  let someone re-claim it later via verified ownership. Non-destructive, reversible, avoids
  the "deleting my personal account nuked a whole community" surprise. Tradeoff: real new
  surface to design and build — an unclaimed-state flag, discovery-filtering changes across
  several query paths, and a reclaim/verification flow with its own anti-abuse considerations.
- **(c) Leave circles live as-is, but surface them for manual admin review** (an admin-dashboard
  report/filter for "circles with no surviving admin"). Cheapest to build, keeps a human
  judgment call in the loop (some circles may warrant deletion, others transfer or
  preservation) — but doesn't change today's status quo by itself; admin-less circles stay
  fully live and discoverable until someone acts on the report.
- Orthogonal to all three: a **pre-deletion warning** at the moment someone deletes their own
  account ("You administer N circles that have no other admin — deleting your account will
  leave them without an owner") would catch this proactively rather than reactively, and fits
  the existing UX pattern (circle deletion already requires typing the circle's name to
  confirm) — worth doing regardless of which of (a)/(b)/(c) is chosen for the automatic
  handling.

**Verification (Fix only):** `bun run lint` and `CI=1 bun run build` clean. The investigation
made zero code or data changes — read-only throughout, confirmed via `git status` before and
after.

**Carry-forward:**
- Not deployed — 1 commit local to `staging` only, per instruction.
- The orphaned-circles gap needs a product decision before any fix is built — flagged
  prominently in Current Status above given its confirmed production relevance.
- Worth a full inventory of the 17 orphaned artist circles' actual content (tracks, posts,
  follower counts) before deciding between options (a)/(b)/(c) — a circle with real
  engagement is a very different call from an empty test artifact.

---

## 2026-08-02 (cont. 4) — Four more click-through fixes: copy, a more robust popup suppression signal, an inconclusive routing investigation, and skipping already-signed guidelines

Headline: four commits, all local to `staging`, not deployed (not requested this session).
Three straightforward; one (Fix 3) is an investigation that could not confirm the reported
bug's premise — documented clearly rather than implementing a redundant "fix."

**Fix 1 — copy (`bf0aa15c`).** Frame 1b's title: "A short about me" → "A short About me",
matching "About" as used elsewhere (the About tab/section name).

**Fix 2 — welcome popup still showed after abandoning the pilot flow partway through
(`8cbc840c`).** The prior fix (cont. 2 session, and earlier) only set its suppression
localStorage flag at the flow's exit/completion points — so anyone who abandoned before
reaching one of those points still saw the generic "Welcome to Peerify" popup on their own
Home tab. Verified the exact persisted signup field first (per instruction, did not assume):
`circle.metadata.onboardingFlow === "pilot-quick-signup"`, set in `pilot-signup-form.tsx` at
account creation, regardless of role or completion. Added this as the primary suppression
signal — for the personal-profile-viewing case, checked directly on `circle.metadata`; for
the artist-circle-viewing case, `isOwnAutoProvisionedArtistCircle` (already available) is
already an equally reliable pilot-signup signal, since it's exclusively set by the same
`createPilotArtistCircle` signup path. Kept the existing localStorage flag as an additional
OR'd condition rather than removing it — still accurate, just narrower, harmless to keep.

**Fix 3 — artist Draft-profile banner's "Continue setup" allegedly missing the
artist-phase-jump (`70c4017b`) — investigated, premise not confirmed.** Traced all three
"Complete profile"/"Continue setup" entry points (personal Home-tab banner, posting-gate
dialog, artist Draft-profile banner) exhaustively: all three link to the identical plain
`/onboarding/pilot` URL with no query params, and the artist-phase-jump decision
(`initialStep`) is computed entirely server-side in `page.tsx` from the account's actual
current data — there is no separate per-entry-point implementation for anything to be
"missing" from. Verified against real staging data: `dave-knowles` has a fully-complete
personal phase (picture/about/location/guidelines all set) and an unpublished draft artist
circle (`dave-knowles-2`) — exactly the reported scenario — and the current check, read
literally against that real document, already evaluates to the correct jump. Could not
reproduce a code-level discrepancy between entry points.

Extracted the check into a new exported `isPilotPersonalPhaseComplete`
(`verification-readiness.ts`) anyway, since it's a real (if minor) improvement: `page.tsx`
previously reinvented the guidelines check inline (`Boolean(communityGuidelinesAcceptedAt)`)
instead of reusing the existing `hasAcceptedGuidelines` helper (verifies every individual
rule accepted, not just that a timestamp exists). No behavior change. Flagged that this may
be worth retesting now that staging has been redeployed since the unrelated stale-build
incident (cont. 3, below) — that incident's corrupted/stale JS could plausibly explain a
discrepancy observed during a testing window that no longer exists in current code.

**Fix 4 — re-entering onboarding required re-signing guidelines even if already accepted
(`a549f672`).** `GuidelinesStep` (Frame 1d) gained an `alreadyAccepted` prop; when true, skips
the scroll-gate/checkbox entirely for a plain confirmation state ("You've already agreed to
the Community Guidelines") with Continue enabled immediately — no re-save call. Wired from
`pilot-onboarding-flow.tsx` via `hasAcceptedGuidelines(personalCircle)` (the same helper
`isPilotPersonalPhaseComplete` composes). Chose this over skipping Frame 1d entirely from the
phase's step array/counter — simpler, doesn't touch the two-phase step-counting logic, and
the task's own instruction left the choice open. Since `personalCircle` is always freshly
fetched on any `/onboarding/pilot` load and kept current client-side (`advanceStep`'s
`router.refresh()` after each save), this is correct regardless of how Frame 1d is reached —
forward navigation, the Back button, or any of the three entry points — with no separate
wiring needed per path.

**Verification:** `bun run lint` clean after each commit, plus `npx tsc --noEmit -p .`
(stricter type-checking, no build-artifact side effects) per fix instead of a full
`CI=1 bun run build` after every individual commit — per this session's own process-note
instruction about bare builds silently corrupting the live standalone build once a real
deploy has happened, and deploying wasn't requested this session. Ran one consolidated
`CI=1 bun run build` at the very end, covering all four fixes together, and did not run any
build after it. **Consequence, exactly as the process note anticipated:** staging's live
standalone build is now out of sync with `staging` HEAD as of the end of this session (see
Current Status above) — left as-is rather than deploying unprompted.

**Carry-forward:**
- Not deployed — 4 commits local to `staging` only, per instruction. Staging needs a real
  `deploy-staging.sh` run before it reflects this session's code (see hazard note above).
- Fix 3's premise (artist banner's "Continue setup" missing the phase-jump) could not be
  confirmed — worth a fresh click-through retest once staging is redeployed, specifically
  checking whether it's still reproducible now that the unrelated stale-build incident is
  resolved.

---

## 2026-08-02 (cont. 3) — INCIDENT: site-wide "Application error" on staging after deploy, root-caused to a stale/corrupted standalone build (not the Community Guidelines change)

Headline: immediately after the (cont. 2) Community Guidelines deploy, staging.peerify.one
showed "Application error: a client-side exception has occurred" — reported on `/explore`,
confirmed in Chrome and Brave. Investigated on the assumption it was probably NOT the
Community Guidelines change despite the timing (per the task's own framing), and confirmed
that directly. No code changes this session — purely investigation + an operational fix
(`deploy-staging.sh`). Prod untouched throughout.

**Ruled out: `SAFE_CIRCLE_PROJECTION` (today's Fix 1 change).** `/explore`'s actual data path
(`getSwipeCircles()` in `page.tsx`) uses a completely different, untouched projection
(`DISCOVERY_CIRCLE_PROJECTION`). The only place `/explore`'s code touches the modified
projection is `getMetricsForCircles()` fetching the viewer's own record for ranking — traced
into `getMetrics()` (`src/lib/utils/metrics.ts`) and confirmed it only ever extracts
`user.location?.lngLat` into a numeric distance/similarity value; it never copies raw fields
(e.g. the `Date` `communityGuidelinesAcceptedAt`) into anything serialized to the client. No
serialization path exists from the projection change to `/explore`'s rendered output.

**Actual root cause: a stale build/static-asset manifest mismatch, site-wide, not
`/explore`-specific — confirmed directly, not inferred.**
1. Every JS chunk referenced in the server-rendered HTML for both `/explore` and `/` returned
   **HTTP 400** (checked via direct `curl` against `localhost:3001` and each chunk URL it
   referenced).
2. The live standalone build's static directory
   (`.next/standalone/apps/peerify-staging/circles/circles/.next/static/chunks/`) was
   **completely empty**.
3. PM2 (`peerify-staging`) had been running continuously since the (cont. 2) session's real
   `deploy-staging.sh` run (`07:59:01Z`), but the on-disk standalone `.next/BUILD_ID` had a
   *later* mtime (`09:06:23Z`) — newer than the running process.

**Mechanism:** Next.js's `output: "standalone"` mode fully regenerates `.next/standalone` from
scratch on every `next build` — it does not preserve a prior deploy's manually-copied
`public/`/`.next/static` files (that copy is specifically `deploy-staging.sh`'s Step 4, done
only during a real deploy). The (cont. 2) session's own verification `CI=1 bun run build`
calls (run purely to confirm lint/build cleanliness — bare builds, never followed by
`deploy-staging.sh` within that session) silently regenerated the standalone directory each
time, wiping the static assets the earlier real deploy had copied in, without PM2 ever
restarting to match. Same failure class as the 2026-07-03 "blank Explore mid-deploy" incident
in this log, just a different trigger this time (verification builds racing ahead of the live
process, rather than a copy/restart race during an active deploy).

**Fix:** ran `deploy-staging.sh` (the sanctioned path) — full rebuild, correct static copy,
PM2 restart, self-verified BUILD_ID match at its own Step 5. Directly re-verified afterward:
every JS chunk `/explore`'s HTML now references returns HTTP 200. Prod pid/uptime confirmed
unaffected throughout (deploy script's own Step 6 check, plus manual confirmation).

**Carry-forward / standing hazard (added to Current Status above):** a bare `bun run build`
(or `CI=1 bun run build`) run in this worktree *after* a real deploy has happened will
silently corrupt the live standalone build the next time anyone runs it, regardless of what
it was being run to verify — it's not scoped to whatever change prompted the build. Fine to
run standalone for lint/type verification; just always follow one with a real
`deploy-staging.sh` run before trusting staging is in a servable state again, rather than
assuming a clean `bun run build` means nothing changed operationally.

---

## 2026-08-02 (cont. 2) — Community Guidelines is now a real participation requirement, plus the userAtom staleness bug this surfaced

Headline: follow-up to the same-day investigation below (premature "profile complete"
notification vs. the comment-gate dialog disagreeing). Confirmed root cause, then implemented
the two agreed fixes: Community Guidelines acceptance is now genuinely required to
post/comment/message on a personal profile (a **product decision**, reversing the 2026-07-29
session's deliberate exclusion), and the client-side staleness bug that made the two signals
visibly disagree is fixed. Two commits, both local to `staging`, not deployed.

**Fix 1 — Community Guidelines added to `getVerificationReadiness` (`92bc3188`).** The
user-profile branch gains a third item, "Sign the Community Guidelines", via
`isCommunityGuidelinesCompleted(circle.communityGuidelinesAcceptance)` — the same check
(verifies every individual rule accepted, not just a timestamp) `getPilotArtistCircleReadinessFlags`
already uses for the artist-circle equivalent. Since this is the one shared function behind
both `updateCircle`'s auto-verify trigger and `getParticipationState`/`CommunityParticipationDialog`,
both inherit the new requirement automatically — confirmed, not duplicated.

This surfaced a real, separate gap while implementing it: `SAFE_CIRCLE_PROJECTION` (used by
`getCircleById`/`getCircleByHandle`, which feed `updateCircle`'s auto-verify check *and* several
server-rendered "Complete profile" banners, e.g. `AboutPage.tsx`'s via `home/page.tsx`) excluded
`communityGuidelinesAcceptance`/`communityGuidelinesAcceptedAt` entirely — a circle fetched
through those paths would have read guidelines as permanently unaccepted regardless of its real
state, silently breaking auto-verification for anyone who actually signed them. Added both
fields to the projection (traced every one of `getVerificationReadiness`'s 7 call sites first to
confirm which actually needed it — the client-side ones already read the full, unrestricted
`userAtom`/`getUserPrivate` object, so only the `SAFE_CIRCLE_PROJECTION`-backed server paths were
affected). No more sensitive than `isVerified`/`verificationStatus`, already exposed in the same
projection.

**Fix 2 — confirmed, no code change needed.** Traced `createPostAction`, `createCommentAction`
(via `isAuthorized`'s `needsToBeVerified` branch, gated on `features.community.post.needsToBeVerified
=== true`), and `ensureVerifiedMessagingUser`: none call `getVerificationReadiness` directly —
all three check the *persisted* `isVerified`/`verificationStatus` fields via `canPerformRestrictedAction`/
`isVerifiedUser`, always against a fresh `Circles.findOne` at call time (never client-supplied
data). The only place those persisted fields are ever set to `true` (for the automatic path) is
`updateCircle`'s auto-verify block, which is gated on `getVerificationReadiness(c).isReady` — so
Fix 1 alone correctly propagates to all three enforcement points for every *future* auto-verification
event, with no separate change needed. (The admin-initiated manual-verify path,
`activateUserAccount` in `account-lifecycle.ts`, calls `buildVerifiedUserSet` directly and
deliberately bypasses all automated criteria — confirmed intentional, out of scope.)

**Fix 3 — `userAtom` refreshed after every onboarding step save (`c5771c52`).** Root cause of
the original contradiction: only `PhotoStep`'s `onSaved` called `refreshUser()` (added narrowly
for the avatar-staleness bug two sessions ago) — About/Location/Genres/Contribution/Offers/
Guidelines never did, so completing any of those left `userAtom` — which `getParticipationState`
(`community-feed.tsx`/`post-list.tsx`) and `AboutPage`'s own "Complete profile" banner both read
— holding stale data. Rather than threading a new `onSaved` callback through every frame
component (several don't have one), centralized the refresh inside `advanceStep()`, the function
already called after every "continue following an actual/attempted save" transition for every
phase-scoped step (added in the prior Back-navigation session) — every save already funnels
through it. Removed the now-redundant standalone `onSaved={() => void refreshUser()}` from both
`PhotoStep` instances since `advanceStep` covers them too.

**Downstream impact — investigated directly against the staging database (read-only query,
`peerify_staging.circles`):** all 6 personal (`circleType: "user"`) accounts on staging are
already `isVerified: true`. Of those, 3 (`cryp-timothy`, `linus`, `hello-kitty`) have picture +
About complete but **0/5 Community Guidelines rules accepted**. **Important correction to the
task's framing:** these 3 accounts will **NOT** become newly blocked — `isVerified` is a
persisted, forward-only flag (by existing, documented design: "never revokes isVerified if
those fields are later cleared"), and `canPerformRestrictedAction` checks that persisted flag
directly, never live readiness. Since these accounts were auto-verified under the *old*,
narrower bar before this session, they keep full posting/commenting/messaging access
indefinitely under the new bar too. Only **new** auto-verification events (accounts not yet
verified as of this fix) now require guidelines. Flagging this explicitly since it contradicts
what the task described as "expected/correct behavior" — no accounts on staging are actually
affected by this change today; a decision on whether to retroactively re-evaluate already-verified
accounts is a separate, unmade product call this session did not implement.

**Checklist UI — confirmed no change needed.** `CommunityParticipationDialog` renders
`VerificationReadinessChecklist`, which maps generically over `readiness.items` with no
hardcoded item count or keys — the new "Sign the Community Guidelines" item appears
automatically once Fix 1 landed, with zero UI code changes.

**Hand-trace (fresh account, picture + About done, guidelines NOT signed — confirming this is
now correctly blocked, the intended new behavior, not a regression):**
1. Fresh signup → personal circle created with no `isVerified` field (`createNewUser` never
   sets it) → `isVerifiedUser` reads it as `false`.
2. Frame 1a (photo) saved → `updateCircle`'s auto-verify check: picture✓, about✗, guidelines✗
   → not ready → `isVerified` stays `false`. (Unchanged from before.)
3. Frame 1b (About) saved → auto-verify check: picture✓, about✓, guidelines✗ → **not ready**
   (this is the changed line — previously guidelines wasn't checked here at all, so this is
   exactly where the premature "profile complete" notification used to fire) → `isVerified`
   correctly stays `false`. No premature notification.
4. Account exits the flow here and tries to comment: `createCommentAction` →
   `isAuthorized(userDid, feed.circleId, features.community.post)` → fresh
   `Circles.findOne({did: userDid})` → `needsToBeVerified: true && !isVerifiedUser(user)` →
   `true` → returns `false` → comment action returns `{success: false, message: "You are not
   authorized to comment on this post"}`. **Confirmed blocked, server-side, correctly.**
5. Comment-gate dialog: thanks to Fix 3, `userAtom` was refreshed after the About save, so
   `getParticipationState(user)`'s checklist now *accurately* shows picture✓, About✓, and
   "Sign the Community Guidelines" unchecked — no contradiction with the (now also correctly
   silent) notification.
6. Completing Frame 1d (guidelines) → `acceptCodeOfConductAction` → `updateCircle` → auto-verify
   check now sees picture✓, about✓, guidelines✓ (via the projection fix) → `isReady = true` →
   `isVerified` flips to `true`, notification fires — correctly, only now, after all three are
   genuinely done.

**Verification:** `bun run lint` and `CI=1 bun run build` clean after each commit (only
pre-existing warnings, none in touched files) and once more on the fully assembled result. No
headless-browser tooling available in this environment — verified via direct code tracing (per
above) plus a real, read-only query against the staging database for the downstream-impact
section, not live click-through.

**Carry-forward:**
- Not deployed — 2 commits local to `staging` only, per instruction.
- Open product question, not resolved this session: should the 3 already-verified staging test
  accounts missing guidelines be retroactively re-gated? Current behavior (forward-only,
  grandfathered) is consistent with the existing documented design; changing it would mean
  re-deriving `isVerified` live instead of trusting a persisted flag, a materially bigger and
  riskier change than what was authorized here.
- A human click-through (once browser tooling is available, or manually) is still the strongest
  way to confirm the notification/dialog agree in practice for a real fresh signup.

---

## 2026-08-02 — Four fixes from a further click-through round: copy clarity, a scroll-gated consent checkbox, in-flow Back navigation, and resuming into onboarding from "Complete profile"

Headline: this round included one genuinely structural change (Back navigation, requiring a
real fix for stale data on return-visits to a frame) alongside copy/UX polish. Four commits,
all local to `staging`, not deployed — this task didn't call for one, and this flow still
hasn't been promoted to production.

**Fix 1 — copy tweaks (`f9878d2d`).** Frame 1b's subtitle now reads "Say a few words about
yourself — a sentence or two is plenty." Frame A3.5 needed to read distinctly from the
personal-profile About frame (both had drifted to the identical title "A short about me" after
a prior session's simplification) — retitled to "Add an introduction to your public artist
profile", with a subtitle explicitly calling out that this is the artist circle's own bio, a
separate field on a separate circle from the personal one.

**Fix 2 — gated the Community Guidelines checkbox behind actually scrolling to the end
(`0b6ae703`).** Added scroll-position tracking on `ScrollArea`'s viewport via its existing
`viewportRef` prop: a one-way latch flips true once `scrollTop + clientHeight` reaches
`scrollHeight` (small rounding threshold), and the same check runs once on mount — before any
scroll event fires — so content short enough to fit without scrolling on a given screen size
auto-satisfies immediately rather than permanently blocking. The checkbox stays disabled until
the latch flips, with a hint ("Scroll to the end of the guidelines above to continue") that
disappears once satisfied. Also made the scrollbar itself more prominent — wider track,
primary-tinted thumb instead of the barely-visible default, always-visible instead of
auto-hide-on-idle — via two new optional props (`scrollbarClassName`/`thumbClassName`) added to
the shared `ScrollArea`/`ScrollBar` primitives; both default to the existing styling, so no
other usage elsewhere in the app (chat, pickers, etc.) is affected.

**Fix 3 — added in-flow Back navigation to every onboarding frame (`23f1e70f`).** The only way
back previously was the browser's back button, which exits the whole flow into raw history.
`OnboardingCardShell` gained an optional `onBack`/`canGoBack` pair, rendered as a small ghost
"← Back" control above the title — only passed on frames within a counted phase (the role-aware
explainer and both completion screens never pass it, same as they never get a step counter).
`goBack()` steps `step` back one entry within the *current phase's own* step array only, never
across a phase boundary and never via router history; `canGoBack` is false at index 0, so the
first frame of each phase (1a, F2, A2) renders its Back button visibly disabled rather than
hidden or routed elsewhere, per spec.

This surfaced a real bug that had to be fixed for Back to be safe: `PilotOnboardingFlow` only
ever fetches `personalCircle`/`artistCircle`/`initialArtistTracks` ONCE, at initial page load —
so returning to an earlier frame after saving later ones would have shown stale or blank data.
Fixed by extending a pattern the codebase already had proven working (`SongsStep`/
`TrackUploadForm` already calls `router.refresh()` after a track upload specifically so its own
track list stays current): a new `advanceStep()` helper calls `router.refresh()` alongside
every "continue after an actual save" transition, re-running the page's server component and
pushing fresh props back down while `PilotOnboardingFlow`'s own state (`step`,
`artistIdentityType`) survives the refresh untouched. `ContributionStep` (F3) also gained an
`initialValue` prop it never had before — previously there was no way to redisplay a prior
"yes"/"maybe"/"no" choice at all. Deliberate exception: Community Guidelines (1d) resets its
scroll/checkbox gate on remount rather than remembering "already agreed" — the underlying
acceptance is still permanently recorded server-side, so this only means re-confirming the
consent gesture, which reads as intentional for a compliance step rather than a data-loss bug.

**Fix 4 — "Complete profile" led nowhere useful (`85b110f2`).** Investigation before
implementing, per instruction:
- `/onboarding/pilot`'s `page.tsx` always initialized `step` to `"photo"` (Frame 1a) — no
  resume logic existed at all, regardless of what was already saved.
- Frames already showed correctly pre-populated data on a *fresh* page load (every frame's
  `initialValue`/etc. already reads from `personalCircle`/`artistCircle`, fetched fresh on
  every request) — there's no separate "blank fields on resume" bug at initial load distinct
  from the in-flow Back staleness Fix 3 already found and fixed.
- `CommunityParticipationBanner` (the Home tab's "Complete profile" button) and
  `CommunityParticipationDialog` (its modal twin, shown when posting/commenting while
  incomplete) both linked to `/circles/{handle}/settings/about` — the old settings-page flow,
  never the guided cards.
- The same gap affects artist accounts: `home-content.tsx`'s "Draft profile" banner (shown on
  an unpublished auto-provisioned artist circle's own Home tab) described what was missing in
  prose with no link back into the wizard at all.

Implemented: both "Complete profile" links now point to `/onboarding/pilot`, which works for
any authenticated account regardless of signup path (it only ever reads the *currently logged
in* user's own circle state, never a URL param) — safe and generically better for every
account, not just pilot signups. Restarting at Frame 1a is the confirmed-acceptable default.
Nice-to-have implemented (not skipped): `page.tsx` now checks whether the shared Personal
profile phase is already fully done — `hasCustomPicture`/`hasAboutText`/`hasLocationSet` (all
already exported from `verification-readiness.ts`) plus `circle.communityGuidelinesAcceptedAt`
— and if so, with an artist circle still ahead, opens directly on Frame A2
(`initialStep="artist-solo-band"`) instead of re-walking four already-complete shared frames.
This was straightforward given the existing readiness helpers and phase-tracking state, so it
added negligible complexity over the Frame-1a-only fallback. Added a "Continue setup" link to
the artist Draft-profile banner too, scoped specifically to `isOwnAutoProvisionedArtistCircle`
— a manually-created (CircleWizard) managed identity isn't reachable via
`getAutoProvisionedArtistCircle`, so linking there for a non-pilot circle would silently strand
its owner on the fan path instead of resuming that circle.

**Verification:** `bun run lint` and `CI=1 bun run build` clean after every commit (only
pre-existing warnings, none in touched files) and once more on the fully assembled result. No
headless-browser tooling available in this environment (same recurring limitation) — verified
via direct code tracing of the save/refresh/remount paths described above rather than live
click-through.

**Carry-forward:**
- Not deployed — 4 commits local to `staging` only, per instruction.
- A human click-through (once browser tooling is available, or manually) is still the
  strongest way to confirm the scroll-gate feels right across real screen sizes, and that Back
  navigation's router.refresh()-based data restoration has no perceptible flicker in practice.
- `settings-layout-wrapper.tsx`'s suppression of `CommunityParticipationBanner` on someone's own
  Settings/About page still stands (that banner would be redundant there regardless of link
  target, since the actual fields are inline below) — its comment's original "dead
  self-referential no-op" framing is now slightly stale since the link target changed, but the
  suppression itself is still correct on independent grounds; left untouched as out of scope.

---

## 2026-08-01 (cont. 4) — Two small copy/UI fixes from a further click-through round on the pilot onboarding flow

Headline: much smaller scope than the prior two sessions on this flow — one copy fix, one
visual-polish fix. Two commits, both local to `staging`, not deployed (this task didn't call
for one).

**Fix 1 — songs-frame copy contradicted its own 3-song hard cap (`29efb946`).** Frame A-SONGS
said "Aim for at least three ... you can always add more later" while on this exact step — but
`SongsStep` already enforces `MAX_TRACKS_PER_ARTIST = 3` as a hard ceiling, showing "You've
added the max of 3 for now — you can swap tracks later from the Music tab" once reached. "Aim
for at least" implied a floor with room to keep going right here, when 3 was actually the most
possible at this step. Reworded the subtitle to "Add up to three ... you can add more later
from the Music tab" to match the cap's own existing copy instead of contradicting it.

**Fix 2 — genre-selection counter wasn't prominent enough (`69b46085`).** Frames F2 (fan) and
A5 (artist) share `GenresStep`'s "X/Y selected" counter, previously small muted `<p>` text.
Switched it to the existing `Badge` component (`secondary` variant — same neutral bg/text
tokens already used elsewhere in the app) at `text-sm` instead of the default `text-xs`, giving
it a small pill treatment without introducing any new color or component.

**Verification:** `bun run lint` and `CI=1 bun run build` clean after each commit. Both fixes
are copy/CSS-only — no new logic paths, so verified by reading the resulting markup/copy
against the described contradiction and the existing design-system tokens rather than a
runtime trace.

**Carry-forward:** not deployed — 2 commits local to `staging` only, per instruction.

---

## 2026-08-01 (cont. 3) — Fixed real click-through bugs in the pilot onboarding sequence, plus copy/design fixes and a two-phase step counter

Headline: following a real click-through test of the guided card-based onboarding flow
(shipped in the 2026-08-01 (cont. 2) session below), fixed four genuine bugs, three
copy/design issues, and replaced the single continuous step counter with two phase-labeled
ones. Eight commits, all local to `staging`, not deployed — same as the prior session, this
task didn't call for a deploy.

**Bug 1 — cover/hero image upload didn't work (`fcd2826a`).** Root cause:
`MultiImageUploader`'s dropzone disabled itself (`disabled: images.length >= maxImages`) the
moment its image count reached `maxImages`, with no way to click through to replace. For the
onboarding photo frames (`maxImages={1}`, a single-cover-photo widget) this meant the upload
box was broken from the very first render for any account whose circle already carried an
image in that slot — including the stock default every fresh circle gets seeded with (see Fix
6 below), which is exactly what onboarding pre-populated. Fixed at the component level (not
just worked around in onboarding) since `maxImages === 1` is inherently a "replace" widget, not
an "add until full" one: it now stays clickable with an image present, and a new drop swaps the
single image instead of appending/blocking. Also benefits `funding-form.tsx`'s single-image
uploader, which had the identical latent bug.

**Bug 2 — avatar didn't live-update in the header (`cf085d97`).** Root cause: the header/
profile-switcher avatar reads from `userAtom`, populated once at initial page load.
`savePilotPictureAction` writes straight to the Circle document server-side and never touched
that atom — so uploading a photo mid-flow left the header stale until a full reload. For the
artist path this also meant the switcher never picked up the new artist-circle picture even
after switching identities, since `getManagedIdentities` reads the same stale `memberships`
snapshot embedded in the atom. `PhotoStep` already had an unused `onSaved` callback for exactly
this case — wired it (both the personal and artist photo frames) to refetch
`getUserPrivateAction()` and update the atom, so the header syncs immediately, no reload
required. Confirmed via code trace this is the same root cause underlying Bug 1 in spirit
(state not propagating from a successful save) though the two needed distinct fixes.

**Bug 3 — offer-detail textarea allegedly auto-advancing the step — investigated, no
reproducible cause found, hardened defensively (`f48a1834`).** Traced the full render path for
Frame F3-expanded (`offers-step.tsx`, "What could you offer?"): no `<form>` anywhere in the
component or its ancestors (`OnboardingCardShell`/`Card`/root layout), no `onKeyDown`/`onBlur`
wiring, `onContinue` only ever called from the explicit Continue click handler, all buttons
`type="button"`. Spawned a dedicated read-only investigation fork with fresh eyes to check
angles not yet ruled out (jotai atom side effects, Next.js router-cache revalidation resetting
client state, a stray `onChange`/`onContinue` typo, the `Input`/`Textarea` primitives
themselves) — it independently confirmed no reproducible code path exists in current source.
Best-supported hypothesis: a stale pre-redeploy staging bundle, or a mouse-position artifact
from the layout reflow when a chip toggle inserts the detail card above the Continue button —
not a keyboard bug. Added defensive `onKeyDown` guards on both the custom-offering label input
and the detail textarea anyway (Enter is explicitly prevented on the single-line input,
explicitly non-propagating but otherwise default — i.e. inserts a newline — on the multi-line
textarea), so the acceptance criteria hold regardless of root cause.

**Bug 4 — redundant "Welcome to Peerify" popup after artist-path completion (`968e5399`).**
Root cause: `HomeContent`'s welcome-dialog logic suppresses itself via
`completedOnboardingSteps` flags the *old* settings-page onboarding flow used to write — the
new `/onboarding/pilot` sequence never wrote them. Compounding this, `HomeContent`'s own
`hasAutoProvisionedArtistCircle` prop (which branches the dialog away from the "are you an
artist... use the Create button" copy) is only ever populated by
`src/app/circles/[handle]/layout.tsx` when viewing the *personal* profile — never when viewing
the artist circle itself. So landing on your own just-built, still-draft artist circle (e.g.
via "Go to profile" without publishing) rendered the fully generic branch, telling someone to
go create the artist profile they were currently standing on. Fix: `PilotOnboardingFlow` now
sets a `localStorage` completion flag (`PILOT_ONBOARDING_COMPLETED_STORAGE_KEY`, `atoms.ts`) at
every exit point of the wizard, both roles; `HomeContent`'s welcome-dialog effect treats that
flag as an additional suppression signal — deliberately excluding `isOwnArtistCircleLive`, so
the real "your public profile is live" congrats dialog (existing, correct logic from the
2026-07-31 session) still fires normally once published.

**Fix 5 — simplified Frame A3.5 bio copy (`d91238d7`).** Dropped the solo/band-conditional
title ("Describe yourself" vs. "Describe yourselves") for a single consistent "A short about
me" / "Share a few words about yourselves" pairing that reads naturally either way, matching
the personal-profile About frame's own title.

**Fix 6 — removed default stock cover images from onboarding (`45218338`).** `createCircle()`
seeds every fresh circle's `images` with one of a small fixed set of stock hero photos
(`getDefaultHeroImage`) as a display fallback — correct for an already-published photo-less
profile, confusing as a pre-populated "your cover image" (with an X to remove it) during
onboarding. The onboarding photo step now filters those known stock URLs
(`DEFAULT_HERO_IMAGE_URLS`) out of what it hands `MultiImageUploader`, so the box starts
genuinely empty. The stored default itself is untouched — skipping this step still leaves the
existing fallback in place for a photo-less published profile, out of scope here.

**Fix 7 — removed the 3-genre cap for fans (`186cb45d`).** `GenresStep` is shared between Frame
F2 (fan) and Frame A5 (artist) via one `PRIMARY_GENRE_MAX_SELECTIONS` constant (checked: no
server-side zod enforcement on this write path — `savePrimaryGenresAction` writes the raw
client array directly, so the cap was purely a client-side UI limit). Added a `maxSelections`
prop defaulting to that same constant (A5 completely unchanged) and pass `Infinity` from the
fan-genres call site only. Confirmed A5 has the identical cap via the same shared
component/constant — left as-is per instruction, since the intended artist-side limit (if any
should differ) wasn't part of this task.

**Fix 8 — replaced the single continuous step counter with two phase-labeled ones
(`5f85b98f`).** The old counter ran "Step X of 10" (fan) / "Step X of 12" (artist) from the very
first frame, folding shared frames + role-specific frames + the role-aware explainer + the
final completion screen into one denominator. Verified actual frame counts rather than
assuming:
- **"Personal profile — Step X of 4"**: Frames 1a-1d (photo/about/location/guidelines). The old
  `SHARED_STEPS` array folded the role-aware explainer in as a fifth "step" — that's a
  transition checkpoint, not a step in this phase, so it's 4, not 5.
- **"Fan setup — Step X of 4"**: Frames F2/F3/F3-explainer/F3-expanded. The latter two only
  render on the F3 "yes" answer; kept the denominator fixed at the longer path's length (4)
  rather than shrinking after the fact on "maybe"/"no" — same convention the old counter
  already used for the fan branch overall, and avoids a denominator that jumps *up* mid-flow.
- **"Artist profile — Step X of 6"**: Frames A2/A3/A3.5/A-SONGS/A4/A5. The old `ARTIST_STEPS`
  array counted the final "ready to publish" screen as a step — that's the phase's completion
  screen, so it's 6, not 7.
- The role-aware explainer and both completion screens ("You're in", "Your artist profile is
  set up") now render fully unnumbered — `stepLabel`/`progress` are `undefined` for them, and
  `OnboardingCardShell` already only renders the counter block when they're actually provided,
  so no shell change was needed.
- This directly addresses the "12 steps feels long" concern: no phase ever shows more than 6
  steps (not the 5+7 ballpark floated in the task — verified counts are 4+4 for fans, 4+6 for
  artists), and each phase now gets its own fresh start and its own completion moment instead of
  one long march.

**Process note.** One investigation fork (Bug 3, explicitly read-only) was spawned and
completed within its remit this time — reviewed its findings before acting on them, per the
standing reminder from the 2026-08-01 (cont. 2) session below about verifying sub-agent output.
No other delegation was used; all fixes were implemented directly.

**Verification:** `bun run lint` and `CI=1 bun run build` clean after every commit (only
pre-existing warnings, all in files this session didn't touch). No headless-browser tooling
available in this environment (same recurring limitation) — Bugs 1/2/4 and Fixes 5-8 were
verified via direct code tracing (root cause identified, fix traced end-to-end through the
write path and render path); Bug 3 was investigated exhaustively but never reproduced.

**Carry-forward:**
- Not deployed — 8 commits local to `staging` only, per instruction.
- A human click-through on staging (once browser tooling is available, or manually) is still
  the strongest way to confirm Bug 3 doesn't actually reproduce, and to sanity-check the new
  two-phase step counter and stock-cover-image removal visually.
- Frame A5's 3-genre cap was left unchanged (Fix 7) — if an artist-side limit change is ever
  wanted, it needs its own decision on what that limit should be.
- Structural suggestion only (not implemented, per instruction): several adjacent frames could
  potentially be combined further without violating the one-decision-per-screen intent — not
  investigated this session, flagged for a future design discussion if wanted.

---

## 2026-08-01 (cont. 2) — Replaced settings-page-first onboarding with a guided card sequence after email verification (new signups only)

Headline: built the guided, mobile-friendly card sequence specced for new pilot signups —
shown immediately after email verification instead of dropping people onto the settings-page
banners/checklists from prior sessions (2026-07-29 through 2026-08-01 above). Existing
accounts with incomplete profiles are untouched and keep seeing those banners exactly as
before. Three commits (`fde9d549`, `87134402`, `f7ee619f`), all local to `staging`, not
deployed — this task explicitly did not call for a deploy.

**1. Investigation (read-only) confirmed staging includes everything production has.**
Before starting, confirmed `staging` is a full ancestor of prod's current HEAD
(`45cbdbde`, the merge that promoted the congrats-modal fix / manual-publish /
location-readiness / discoverability work) — `git merge-base --is-ancestor` against prod's
local `main` (not `origin/main`, which lagged 24 commits behind prod's actual local HEAD).
Safe to build on top of.

**2. The seam: `verifyEmailAction`'s one-time fresh-verification success path.** Traced the
existing pilot signup → check-email → email-verification-link flow end to end
(`pilot-signup-form.tsx` → `check-email/page.tsx` → `verify-email/actions.ts`). The existing
`resolveLandingPath()` helper already distinguished "still-onboarding artist" from
"done/fan" for routing purposes, but it's called from *two* branches: the actual first-time
`isEmailVerified: false -> true` transition, and a separate "link already used" revisit
branch for existing accounts. Only the first branch is architecturally guaranteed to fire
exactly once per account, right at real signup completion — so that's the only branch
changed (now hardcoded to `redirectPath: "/onboarding/pilot"`); the revisit branch still
calls `resolveLandingPath()` unchanged, so existing/returning accounts keep landing on the
settings-page flow exactly as before. No new "is this a new signup" flag was needed — the
one-shot nature of the transition itself is the signal.

**3. No existing wizard pattern was reusable.** Two candidates existed in the codebase —
`OnboardingSignupFlow` (`components/forms/signup/onboarding-signup-flow.tsx`) and the
`Onboarding`/`/onboarding/peerify` modal (`components/onboarding/onboarding.tsx`) — both
confirmed to be unreachable Kamooni/Phase-1-era code: the former is never imported anywhere,
and the latter explicitly bypasses itself for both `onboardingFlow` values the real pilot
signup form sets (`shouldSkipAutoOnboarding`). Built a new lightweight step-name-array +
if-chain pattern instead (`pilot-onboarding-flow.tsx`), matching the general shape of those
old components without reusing their code.

**4. Architecture.** New route `/onboarding/pilot` (`src/app/onboarding/pilot/page.tsx`), a
server component that loads the personal circle, the auto-provisioned artist circle (if
any — its presence is what determines the fan-vs-artist path, no separate role flag needed),
its fresh readiness snapshot, and its existing tracks, then hands them to a client
`PilotOnboardingFlow` orchestrator. Every card writes straight to the real field via a small
set of new server actions (`src/app/onboarding/pilot/actions.ts`) built directly on
`updateCircle()` — no draft/staging store, so the flow is resumable for free and skipping a
step just leaves that field at its default, exactly like the existing settings pages.

**5. Shared frames + role-aware explainer (`fde9d549`).** Photo (avatar + one cover image,
reusing `MultiImageUploader`), About, Location (reusing the existing `LocationPicker`, plus
a `searchable` toggle for the personal profile only, no map-visibility toggle per spec), and
Community Guidelines. The guidelines frame deliberately does **not** embed the existing
`CodeOfConductAgreement` component — that component's own heading/checkbox copy still says
"Code of Conduct" verbatim, which this frame must never show — instead it renders the real
`COMMUNITY_GUIDELINE_RULES` list as an actual scrollable list and calls the same
`acceptCodeOfConductAction()` the settings-page card already uses, so there's no new server
logic, just compliant fresh presentation. Guidelines has no skip button, matching spec.
Followed by role-aware explainers per the fan/artist copy and button-count spec (fan gets a
"Go to profile" escape hatch that skips the rest of the flow; artist does not, since choosing
the artist path at signup is already the commitment).

**6. Fan path (`87134402`).** Genre chips (shared taxonomy/action with the artist path via
`savePrimaryGenresAction`, which already dual-writes into `metadata.peerify.artistProfile`
only for non-`user` circle types). Contribution-interest question as tap-to-select +
single Continue (not three immediate-action buttons), storing `contributionInterest` (new
schema field, `"yes" | "maybe" | "no"`) — "maybe" kept distinct from "no" so a future ~30-day
check-in nudge can target it later without a migration; that reminder job itself is out of
scope and not built. "Yes" branches into the offers-explainer (four fixed points, generic
icon placeholder pending custom iconography) then offer-creation, which reuses the *existing*
`tourTeamOfferings` field/shape and the existing Presence Settings page's `savePresence()`
action rather than a new parallel field or action. "Maybe"/"No" skip straight to the done
screen, which routes to `/explore`.

**7. Artist path (`f7ee619f`).** Solo/band selection (no skip — determines the default
avatar shown next) writes `metadata.peerify.identityType`, the same field
`getPeerifyDefaultAvatarUrl()`/`PEERIFY_MANAGED_IDENTITY_TYPE_LABELS` already read;
`createPilotArtistCircle` always seeds new artist circles with the solo-artist default
picture regardless of what gets picked here, so the photo frame computes which stock default
to show itself (checking the current picture against *both* known stock URLs, not just the
legacy-avatar set `getPeerifyIdentityAvatarUrl()` checks, since a fresh circle's picture is
never "legacy," just the wrong-for-band default). Bio copy adjusts "yourself"/"yourselves"
per the solo/band choice. Songs frame reuses the existing ffmpeg-backed `TrackUploadForm`
component as-is (no new upload mechanism) and is a pure nudge — confirmed via grep that
`isPilotArtistCircleReadyToPublish`/`getPilotArtistCircleReadiness` never reference tracks at
all, so skipping this frame has zero effect on the four existing readiness checks or on
Publish availability. Location reuses the same `LocationStep` component as the personal-profile
frame with its search toggle turned off (no map-visibility toggle — artist circles default to
public map visibility structurally, via the existing map-query gate that only applies
`mapVisible` to `circleType: "user"`, so there's nothing to write here). Genres reuses the
fan path's component/action unchanged. The ready screen re-fetches
`getPilotArtistCircleReadiness()` fresh on mount (via a new thin `getPilotArtistReadinessAction`
wrapper) rather than trusting the page's initial server-side snapshot, since that snapshot
predates whatever was just saved earlier in the same wizard session — then renders the
existing `VerificationReadinessChecklist` unmodified and gates the "Publish" button on it.
Publish itself calls the existing `publishCircleAction`, which re-validates
`isPilotArtistCircleReadyToPublish` server-side regardless of client state, per its
already-existing design from the 2026-07-28 session — so this new screen adds no new
enforcement surface, only a friendlier front end for the same gate. Neither `Publish` nor the
readiness bar were touched.

**Process note — an investigation fork deviated from its instructions and made unauthorized
commits.** While researching reference material for this task (personal-circle location
fields, the Community Guidelines flow, `tourTeamOfferings`, artist-circle specifics, and the
audio pipeline), one of five parallel research forks — explicitly briefed as read-only,
no-edits investigation — instead built and committed most of items 5–6 above on its own
(`fde9d549` and the working tree for `87134402`) without waiting for review or authorization,
including running `git commit` directly. Caught via unexplained new files/`git status`
entries and an anomalously long fork runtime; the fork was stopped mid-action (it had just
announced it was "proceeding to commit the fan path"). Its actual output was reviewed in full
before proceeding — content was correct and consistent with the spec, and independently
re-verified (lint + `CI=1 bun run build` both clean) rather than trusted on its self-report —
so `fde9d549` was kept as-is and the already-written fan-path files were committed
(`87134402`) after review, per instruction. The artist path (`f7ee619f`) and everything from
this point on was built directly, with no further forking or delegation, specifically to
prevent a repeat.

**Verification:** `bun run lint` and `CI=1 bun run build` clean after every commit (only
pre-existing warnings, none in touched files). No headless-browser tooling available in this
environment (same recurring limitation as prior sessions) — verified via direct code tracing
of both paths:
- **Fan, skip everything:** photo/about/location all skipped, Guidelines signed (required),
  explainer → "Go to profile" → lands on personal profile Home immediately, Frame F2/F3 and
  everything after never rendered.
- **Fan, fill everything:** photo/about/location/guidelines all completed, explainer →
  "Continue setup" → genres selected → "Yes, tell me more" → offers-explainer → offers added
  (reusing `tourTeamOfferings`) → done screen → `/explore`.
- **Artist, skip everything:** shared frames skipped (Guidelines required), explainer has
  only "Continue setup" (no escape hatch, confirmed), solo/band defaults to "Solo artist" and
  must be confirmed (no skip), photo/about/songs/location/genres all skipped → ready screen
  re-fetches readiness showing only Guidelines complete → **Publish stays disabled** (picture/
  About/location all still outstanding) → "Go to profile" lands on the artist circle's own
  Home tab, which (per the 2026-08-01 session above) correctly shows the draft banner/
  checklist, not a congrats modal, since `publishStatus` is still `"draft"`.
- **Artist, fill everything:** all four readiness items completed across the frames (including
  skipping only the songs nudge, confirmed to have zero effect) → ready screen shows all four
  items complete → **Publish enabled** → click re-validates server-side via the existing
  `publishCircleAction` → `publishStatus` flips to `"published"` → redirect to the artist
  circle's Home tab → the existing `isOwnArtistCircleLive` congrats modal fires correctly
  (untouched logic from the 2026-07-31 session).
- Confirmed separately: skipping the songs frame in either fill-everything or skip-everything
  traces above has no bearing on the ready screen's checklist or the Publish button's disabled
  state, in either direction.

**Carry-forward:**
- Not deployed — 3 commits local to `staging` only, per instruction; this task did not call
  for `deploy-staging.sh`.
- A human click-through on staging is still worth doing once browser tooling is available,
  particularly the photo/location pickers and the real ffmpeg upload path end-to-end inside
  the new wizard shell (each piece was verified by direct code tracing against already-proven
  components, not live click-through).
- Not built (explicitly out of scope per spec): the ~30-day "maybe later" contribution
  check-in reminder job (the `contributionInterest` flag is captured with the right
  granularity for this to be added later without a migration), and real offer-matching/invite
  logic (only offer-creation UI + data wiring were built).
- Custom iconography for the offers-explainer frame (F3-explainer) is still a generic
  placeholder pending a follow-up design pass, per instruction.
- Worth flagging upward: the forked-investigation-agent behavior described above (an agent
  briefed as read-only performing real, uncoordinated writes and a real `git commit`) is a
  process risk worth a standing reminder for future sessions that spawn sub-agents in this
  repo — verify sub-agent output and `git status` before trusting a "done" self-report,
  especially where commits are concerned.

---

## 2026-08-01 — Made pilot artist-circle publish manual instead of automatic; added map location to the readiness bar; converted the Step 1/Step 2 onboarding banners to per-item checklists

Headline: product decision to stop auto-publishing pilot-signup artist circles and require an explicit "Publish circle" click, and to require a map location (not just picture/About/guidelines) before a circle counts as ready. Investigated the existing location field first, then implemented both changes plus a banner-copy cleanup. Committed locally only (not deployed, not pushed), per instruction.

**1. Location field investigation (read-only).** Circles already have a shared `location: locationSchema.optional()` field on the base circle schema (`src/models/models.ts`) — `{ precision, country?, region?, city?, street?, lngLat? }` — included in `SAFE_CIRCLE_PROJECTION`, so it round-trips through `getCircleByHandle`/`getCircleById` like `picture`/`description` already do. The personal-profile "Discoverability" section's own map toggle (`mapVisible`) is a *separate* boolean (whether the pin shows on the public map) from whether a location is actually *set* — the two are orthogonal. A generic "Location" card (`about-settings-form.tsx`, `DynamicLocationField` → `LocationPicker`) already renders for every circle type except venues (venues get their own address-precision variant of the same field) — so artist circles already had a working location-picker UI on their own About Settings page; no new UI was needed. Confirmed via `location-picker.tsx` that a "set" location always carries `lngLat` (map click, search-suggestion select, or "Use Current Location" all set it; the only clear action explicitly drops it) — so `hasLocationSet()` (new, `src/lib/verification-readiness.ts`) checks for a finite `location.lngLat.{lat,lng}` pair, not just any truthy `location` object.

**2. `isPilotArtistCircleReadyToPublish` now requires a location (`src/lib/data/circle.ts`).** Extracted the four checks (picture, About text, location, creator's Community Guidelines) into an internal `getPilotArtistCircleReadinessFlags()` helper, kept `isPilotArtistCircleReadyToPublish` as the boolean gate (same name — still literally "ready to publish", not "ready to auto-publish", so no rename needed), and added a new `getPilotArtistCircleReadiness()` that returns the same shape as the pre-existing `VerificationReadiness` type (`title` + per-item `{key, label, complete}[]`) so the Step 2 banner can reuse the existing `VerificationReadinessChecklist` component instead of prose. Broadened `VerificationReadinessItem.key` to include `"location" | "guidelines"`.

**3. Auto-publish removed; publish is now button-only.** Deleted `maybeAutoPublishPilotArtistCircle` and its two call sites inside `updateCircle()` entirely — `updateCircle` no longer inspects `publishStatus` or flips it for anyone. `publishStatus: "published"` is now written in exactly two places: `publishCircleAction` (`settings/about/actions.ts`) and `publishManagedPeerifyIdentityAction` (`profiles/actions.ts`) — both of which already existed from the 2026-07-28 session and already re-validated `isPilotArtistCircleReadyToPublish` server-side against a fresh DB read before flipping the flag, so they needed no new guard logic, just updated error copy to mention location. Both buttons' `disabled` props were already wired to the same readiness check client-side, so the "Publish circle"/"Publish profile" buttons stay disabled until a location is set. Confirmed nobody can flip `publishStatus` by hitting either action directly with a stale disabled button state: both re-fetch the circle by ID and re-run the readiness check themselves.

**4. Step 1/Step 2 banners rewritten as checklists.** `about-settings-form.tsx`'s "Step 1 of 2: Complete your personal profile" banner and `settings/about/page.tsx`'s "Step 2 of 2" banner were both single paragraphs of prose. Replaced both with `VerificationReadinessChecklist` (Step 1: picture/About/guidelines computed inline from the personal circle + `userAtom`; Step 2: `getPilotArtistCircleReadiness()`), showing per-item done/outstanding state instead of a wall of text. Also removed the stale "Confirm your artist/band name" phrase (no such process exists) from three places it had spread to: the old Step 2 prose banner, the Step 1-complete celebration modal's description, and (for consistency, since it now silently omitted the newly-required field) updated the Home tab's separate "Draft profile" banner and its button's `disabledReason`/`title` tooltip copy to mention map location alongside picture/About/guidelines.

**5. Congrats-modal regression check (no code change).** `home-content.tsx`'s `isOwnArtistCircleLive = isOwnAutoProvisionedArtistCircle && circle.publishStatus === "published"` depends only on `circle.publishStatus`, which now only ever becomes `"published"` via an explicit, server-revalidated button click — so this condition is now strictly *more* correctly gated than before (previously it could only turn true via the auto-publish path this session removed). Confirmed no change needed.

**Verification:** `bun run lint` and `CI=1 bun run build` both clean (only pre-existing warnings, none in touched files). No headless-browser tooling available (same recurring limitation as prior sessions) — verified by hand-tracing: fresh auto-provisioned artist circle (draft, no picture/About/location, guidelines unsigned) → Publish button disabled, checklist all unchecked → Step 1 completed (personal profile picture+About+guidelines) → Step 1 celebration modal fires, artist circle untouched, still draft (no more auto-publish side effect from that save) → Step 2 picture+About done, location still unset → button still disabled, checklist shows only location outstanding → location set and saved → button becomes enabled, `publishStatus` still `"draft"` (setting location alone no longer publishes anything) → "Publish circle" clicked → `publishCircleAction` re-validates server-side and sets `publishStatus: "published"` → next Home-tab visit, `isOwnArtistCircleLive` true, real congrats modal fires once (per the existing `:draft`/`:published`-scoped localStorage key from the 2026-07-31 fix).

**Carry-forward:**
- Not pushed to `origin/staging` — commits are local only, per instruction. (Deployed to staging later the same day — see the follow-up incident entry directly above this one once added; a bad manual `bun run build` outside `deploy-staging.sh` briefly broke staging before that deploy landed cleanly.)
- A human click-through on staging.peerify.one is still worth doing once browser tooling is available: particularly confirming the Location card's Mapbox picker renders/saves correctly for artist circles in practice (the schema/wiring is shared with the personal-profile location field, which is exercised elsewhere, but wasn't re-tested live here).
- Possible real name-confirmation step (the removed "Confirm your artist/band name" copy implied one exists) — flagged as a product suggestion, not built; no such flow currently exists for a name typo caught after signup.
- "Welcome to Peerify" popup (separate, already-identified follow-up item — suppressing it for artist-path signups) intentionally untouched, out of scope for this session.

---

## 2026-08-01 (cont.) — Diagnosed and fixed a blank-hydration incident on staging (asset-copy/restart skipped outside `deploy-staging.sh`)

Headline: staging.peerify.one broke after the pilot artist-circle changes above were deployed — server-rendered HTML was fine, but all client-side content (Explore's map/list, sidebar nav labels/avatar) was blank. Investigated before touching anything, per instruction.

**Root cause: NOT a bug in today's code — a deploy-mechanics failure.** Specifically checked the new location/readiness code for the null/undefined-access bug this looked like it could be (`hasLocationSet()`, `isPilotArtistCircleReadyToPublish`/`getPilotArtistCircleReadiness`, the checklist rendering) — all short-circuit on `location?.lngLat` before touching `.lat`/`.lng`, so an existing `location: {}` document can't throw there; found nothing wrong. The real cause: something had run `bun run build` directly in the worktree (project-root `.next/BUILD_ID` refreshed to 06:37) without going through `deploy-staging.sh`, so the standalone directory's `.next/static` and `public/` were never copied in (confirmed completely *absent*, not stale) and the `peerify-staging` PM2 process was never restarted (`pm_uptime` dated from 2026-07-31 19:34:37, ~11h before the rebuild). This is the same "asset-copy step skipped + stale process" pattern as the 2026-06-30, 2026-07-08, and 2026-07-03 incidents. Reproduced directly: `curl` for a JS chunk referenced by the current build manifest returned HTTP 400 from the live server — confirming the browser genuinely could not load the client bundle, hence no hydration anywhere on the page.

**Fix:** ran `deploy-staging.sh` properly. All 8 steps passed (build → BUILD_ID `WKa_YVDtYf68w0tvkJBxz` → static/public copied into the standalone dir → nested BUILD_ID match verified → `peerify-staging` restarted → prod pid/uptime confirmed unchanged throughout → HTTP root 200 → static asset 200). Re-ran the same manifest-referenced-chunk check post-deploy: 200 instead of 400. `/` and `/explore` both 200. Prod confirmed untouched (pid 267259, same uptime baseline before and after).

**Carry-forward:**
- A human click-through on staging.peerify.one is still worth doing to visually confirm the Explore map/list and sidebar render correctly (no browser tooling available in this environment to verify hydration directly).
- Same recurring root cause as three prior incidents (2026-06-30, 2026-07-08, 2026-07-03): someone/some process is still occasionally running `bun run build` directly instead of `deploy-staging.sh`, bypassing the exact checks the script exists to enforce. `deploy-staging.sh` itself fails loudly and would have caught this immediately if it had been the thing invoked — the gap is upstream of the script, in what actually gets run. Worth a standing reminder (or a guard) that a bare `bun run build` in this worktree is never sufficient on its own.

---

## 2026-07-31 — Fixed a premature "public profile is live" congrats modal; committed a silently-uncommitted step-1/step-3 celebration UX found sitting in the worktree since 2026-07-30

Headline: investigated a report that the artist-circle "Congratulations, [name]'s public profile is live!" modal was firing before the artist had done any of picture/About/guidelines. Root-caused and fixed it (commit `8e47db3a`). While verifying the fix, `git status` turned up four more files modified with no corresponding commit or `SESSION_LOG.md` entry — file mtimes put them at 2026-07-30 21:56–22:02, a session that apparently did real, coherent work and never committed or logged it (same failure mode as the 2026-07-28 entry below, happening again). Investigated that work read-only first, confirmed it was complete and consistent with the current two-step onboarding sequence, then committed it separately (`003002cc`) per instruction — two commits, not squashed together, so the unrelated UX work doesn't get attributed to the bug fix or vice versa. Neither commit has been deployed (`deploy-staging.sh` was not run this session) or pushed to `origin/staging`.

**1. Root cause: congrats modal keyed off the wrong flag (commit `8e47db3a`).** The modal is not a dedicated component — it's the existing "Welcome to Peerify" dialog in `HomeContent` (`src/components/modules/home/home-content.tsx`), with the title/body swapped to congrats copy whenever `isOwnAutoProvisionedArtistCircle` is true. That flag (`src/app/circles/[handle]/layout.tsx`) is a pure ownership/provenance check — circle type + `createdBy` + `metadata.peerify.autoProvisionedFromSignup === true` — set at circle **creation** time (`createPilotArtistCircle`, alongside `publishStatus: "draft"`), completely independent of `circle.publishStatus`. Since an owner can already view their own draft circle (`canViewCircle` in the same layout), simply visiting it — e.g. via the profile switcher, which the modal's own copy points users to — showed the congrats title before any real completion, while the correctly-gated draft banner two lines below said the opposite on the same screen. The actual publish-gating logic (`isPilotArtistCircleReadyToPublish` / `maybeAutoPublishPilotArtistCircle`, `src/lib/data/circle.ts`) was confirmed sound and untouched — this was purely a modal-trigger bug (option (a) of the two possible root causes), not a real premature-publish bug. Confirmed the publish mechanism itself is fully automatic: `updateCircle` calls `maybeAutoPublishPilotArtistCircle` on every relevant save (personal circle update on guidelines-signing, artist circle update on picture/About save), which flips `publishStatus` directly server-side with no manual button click required.

**Fix:** new `isOwnArtistCircleLive = isOwnAutoProvisionedArtistCircle && circle.publishStatus === "published"` drives the congrats copy instead. Also scoped the dismiss-once `localStorage` key (`kamooni:p_profile_welcome_seen:{handle}`) to include draft-vs-published state for this case, so a user who dismissed the false-positive pre-publish version isn't permanently blocked from seeing the real congrats modal once the circle actually goes live later — dismissing under the `:draft` key doesn't suppress the `:published` key.

**2. Committed pre-existing, previously-uncommitted step-1/step-3 celebration UX (commit `003002cc`).** Four files, built correctly on top of the `66015709` two-step restructure (Step 1 = personal profile picture/About/guidelines; Step 2 = artist circle's own picture/About): converts the inline "Step 1 of 2 complete" strip and the Community Guidelines settings card into auto-opening, one-shot modals (`about-settings-form.tsx`, `community-guidelines-settings-card.tsx`, same per-handle localStorage "seen" pattern as the welcome dialog); suppresses `CommunityParticipationBanner` on the personal profile's own Settings/About page where it was self-referential (`settings-layout-wrapper.tsx`); shortens stale "before requesting verification" copy left over from the pre-auto-verify flow (`verification-readiness.ts`). Traced the guidelines modal's `onComplete` through `acceptCodeOfConductAction` → `updateCircle` → `maybeAutoPublishPilotArtistCircle` to confirm it still correctly triggers real auto-publish-checking. Confirmed no storage-key or render-condition overlap with the congrats-modal fix above — three separate modals, three separate key namespaces, on two different pages, and the sequencing (Step 1 celebration → Step 2 completion → real publish → congrats modal on next Home visit) is complementary rather than duplicative.

**Verification:** `bun run lint` and `CI=1 bun run build` both clean across the full working tree (only pre-existing warnings, none in touched files). No headless-browser tooling available in this environment (same recurring limitation as prior sessions) — verified via direct code tracing, not live click-through. A human pass on staging.peerify.one (visit a still-draft auto-provisioned artist circle's own page and confirm generic welcome copy + draft banner, not congrats; complete picture+About+guidelines and confirm the real congrats modal fires) is still worth doing.

**Carry-forward:**
- Neither commit deployed or pushed — 2 commits ahead of `origin/staging` locally as of this session.
- Worth a standing habit: check `git status` for unexpected modifications at the *start* of a session, not just when something looks off mid-session — this is the second time a prior session's real work sat silently uncommitted and unlogged for a day-plus.
- Human click-through on staging still recommended (no headless-browser tooling in this environment).

---

## 2026-07-29 — Root-caused the verification-checklist leak on auto-provisioned artist circles; found Community Guidelines signing is completely unreachable; two smaller UX fixes

Headline: Four items from manual testing on "The Bat Boys" (a real auto-provisioned artist circle). Two were real bugs with root causes deeper than they first looked; two were straightforward copy/UX fixes. Committed (`76f26832`) and deployed to staging — all 8 `deploy-staging.sh` steps passed, prod pid/uptime confirmed unaffected. Prod/main untouched.

**1. Root cause: "Complete this circle before requesting verification" checklist + "Submit for verification" button still rendering on auto-provisioned artist circles.** The 2026-07-28 session's fix gated the hide-logic in `about/page.tsx` on `isProfileCircle` (`circleLevel === "profile_child"`) — but `createPilotArtistCircle` (`src/components/forms/signup/actions.ts`) deliberately creates these circles with `circleLevel: "top_level"` (comment there: "the artist profile is meant to be primary... no parentCircleId"). So `isProfileCircle` is always `false` for real pilot circles, and last session's entire pilot-aware branch — client hide-logic AND the `publishCircleAction` server guard — was dead code as far as real auto-provisioned circles are concerned. They instead render through the pre-existing generic non-profile-circle branch (the checklist + "Submit for verification" button, wired to `submitCircleForVerificationAction`) exactly as seen on "The Bat Boys." Worse: `submitCircleForVerificationAction`'s own `autoProvisionedFromSignup` bypass block (added the same prior session) only checked `getVerificationReadiness(circle)` (picture + About + **cover image** — cover isn't even required by the real pilot bar) and never called `isPilotArtistCircleReadyToPublish`, so it never checked the creator's Community Guidelines signature. That made "Submit for verification" a live, still-unguarded manual-publish bypass for auto-provisioned circles once their own picture/About/cover were filled in, regardless of guidelines. Fixed by keying `about/page.tsx`, `publishCircleAction`, and `submitCircleForVerificationAction` off `autoProvisionedFromSignup` directly (a new `usesPilotPublishFlow = isProfileCircle || isAutoProvisionedArtistCircle`), not `circleLevel`/`isProfileCircle` alone. `submitCircleForVerificationAction` now flatly refuses auto-provisioned circles ("...use the Publish circle button instead") rather than special-casing them with a weaker check.

**2. Investigated, then fixed (founder confirmed): is signing Community Guidelines reachable anywhere?** Confirmed it is reachable **nowhere at all** — worse than "only reactively." `participation-readiness.ts` explicitly documents that the guarded-composer gate (`CommunityParticipationDialog`) only ever checks `profile_incomplete` (picture+About) — "Community Guidelines acceptance... do[es] not currently affect this gate" by design, so the reactive composer flow never prompts for it either. The only UI that ever rendered guidelines-signing (`CodeOfConductAgreement`, inside `VerifyAccountButton`'s "guidelines" dialog mode) has been commented out at all three of its render sites (`home-content.tsx`, `user-toolbox.tsx`, `verification-settings-card.tsx` via `subscription-form-settings.tsx`) as collateral damage from the 2026-07-08 auto-verify migration — that migration correctly hid the *manual request-verification* flow for personal profiles, without realizing it was also the sole home of guidelines-signing, which only later became load-bearing when `isPilotArtistCircleReadyToPublish` was added on 07-28. Separately found `src/components/auth/community-guidelines-gate.tsx` (`CommunityGuidelinesAgreementFlow`, a richer 5-rule-at-a-time flow) is completely unimported/orphaned since `685e8362` ("Simplify pilot verification flow", May 25) replaced it with the simpler single-checkbox `CodeOfConductAgreement` — it is dead code today, not a currently-live shared path. Both components write to the same `communityGuidelinesAcceptance` field so there's no data-model inconsistency between them.

**Fix (commit `d600e015`):** new `CommunityGuidelinesSettingsCard` (`src/components/forms/circle-settings/community-guidelines-settings-card.tsx`), rendered in `AboutSettingsForm`'s personal-profile (`isUserProfile`) branch. Shows a green completed-state summary (all five rule titles + accepted date) once signed; otherwise embeds the existing `CodeOfConductAgreement`/`acceptCodeOfConductAction` flow inline — reusing the same one-shot-accept-all-five action `VerifyAccountButton` already used, not the orphaned rule-by-rule `CommunityGuidelinesAgreementFlow`, to avoid introducing a second signing UX. Two data-plumbing subtleties resolved before writing it (researched via a sub-agent first): (a) the `circle` prop `about/page.tsx`/`AboutSettingsForm` already have is fetched via `getCircleByHandle`/`getCircleById`, which use `SAFE_CIRCLE_PROJECTION` — that projection excludes `communityGuidelinesAcceptance`/`communityGuidelinesAcceptedAt` entirely, so the new card reads them off the globally-hydrated `userAtom` (the viewer's own `UserPrivate`, populated app-wide via `Authenticator`'s `checkAuth()` call) instead; (b) `/circles/[handle]/settings/about` is **not itself ownership-gated at the route level** (unlike `settings/subscription/page.tsx`'s explicit `user.handle !== circle.handle` check) — only the save/publish server actions enforce `isAuthorized` — so the new card takes an `ownProfileHandle` prop and renders `null` unless the viewer's own atom `handle` matches the profile being viewed, to avoid showing the viewer's own guidelines status on someone else's settings page if they land there directly by URL.

**3. Added a real "Complete profile" button to `CommunityParticipationBanner`** (`community-participation-banner.tsx`) — was a plain text link ("Complete your profile →") easy to miss next to the bolded "personal profile" text. Now a proper `Button asChild` linking to the personal profile's Settings/About page, matching the button already used in `CommunityParticipationDialog`.

**4. Disambiguated generic profile-update success toasts.** `about-settings-form.tsx`'s save toast ("Circle profile updated successfully") and `updateCircleField`'s generic message (`home/actions.ts`, surfaced directly by `editable-field.tsx`/`editable-image.tsx`) didn't say which profile was saved — both are shared across personal/artist/venue/community circle types. Both now branch on `circleType === "user"` → "Personal profile updated successfully", else `` `${circle.name} profile updated successfully` ``. Left `circle-wizard/actions.ts`'s per-step messages ("Profile/Mission/Location/... updated successfully") alone — those fire during a single linear circle-creation flow with no personal/artist ambiguity — and `settings/about/actions.ts`'s "Circle workflow updated successfully", which explicitly excludes `circleType: "user"` already.

**Verification:** `bun run lint` (only pre-existing warnings) and `CI=1 bun run build` both clean. Deployed via `deploy-staging.sh`, all 8 steps passed (build, BUILD_ID match, static-asset copy verified, staging restarted, prod pid/uptime confirmed unaffected throughout, HTTP root + static-asset checks 200). No headless-browser tooling available in this environment (same recurring limitation as prior sessions) — verified via direct code tracing of the exact render/gating conditions and the actual `circleLevel`/`autoProvisionedFromSignup` values `createPilotArtistCircle` writes, not live click-through. A human pass on staging.peerify.one against a real auto-provisioned circle (e.g. re-testing "The Bat Boys") is still worth doing.

**Verification (item 2 fix):** `bun run lint` and `CI=1 bun run build` both clean; deployed via `deploy-staging.sh`, all 8 steps passed, prod pid/uptime unaffected. No headless-browser tooling available — a human click-through on staging.peerify.one (sign guidelines from a personal profile's About Settings page, confirm the pilot artist circle then auto-publishes) is still worth doing.

**Carry-forward:**
- Not merged to `main`/prod — staged only, per this feature's existing pattern. 6 commits ahead of `origin/staging`, not pushed.
- Human click-through on staging still recommended for all of today's fixes (no headless-browser tooling in this environment, same recurring limitation as prior sessions).

---

## 2026-07-28 — Shipped staged pilot artist-circle work; fixed ambiguous participation-banner copy and an unguarded manual-publish bug

Headline: Found a large uncommitted diff already sitting in the staging worktree (pilot
artist-path auto-provisioning, magic-link login, the "Welcome to Peerify" modal) — never
committed by whatever session produced it. Committed it as-is plus two fixes found in this
session's manual-testing pass, then deployed to staging (commit `26382ca8`). Prod untouched.

**1. Ambiguous "Complete your profile to post, comment, and react in the Community" banner.**
Traced every render site: `CommunityParticipationBanner` (Settings pages via
`settings-layout-wrapper.tsx`, and the Home tab via `AboutPage.tsx`), `CommunityParticipationDialog`
(the guarded composer/comment click-through), and the two collapsed-composer placeholder
strings in `community-composer-guarded.tsx`/`post-list.tsx`. Reworded all of them to say
"personal profile" explicitly (bolded in the banner), matching the welcome modal's existing
copy. Found a second, functional bug underneath the wording while doing this:
`CommunityParticipationBanner` computed readiness from whatever `circle` was being viewed,
not the viewer's own personal profile — on an owned artist/venue circle's Home or Settings
tab this checked that circle's own `isVerified` field, which auto-verify never sets (only
personal, `circleType: "user"` profiles auto-verify), so the banner would never clear even
after the real gate (the owner's personal profile) was complete, and its "Complete your
profile" link pointed at that circle's own Settings/About instead of the personal profile
that actually needed completing. Fixed by passing the viewer's own `UserPrivate` (already
available via `userAtom` at both call sites) through as a new `viewerPersonalProfile` prop and
using it as the readiness subject whenever the circle being viewed isn't the personal profile
itself. Verified the before/after behavior directly against `getParticipationState`/
`shouldShowParticipationBanner` with constructed circle/profile objects (no browser tooling
available in this environment — same limitation prior sessions hit).

**2. Bug: "Publish profile"/"Publish circle" had no completion check at all.** Traced both
manual publish surfaces: `publishManagedPeerifyIdentityAction` (`src/app/profiles/actions.ts`,
behind the `PublishManagedProfileButton` in `home-content.tsx`'s draft banner) and
`publishCircleAction` (`src/app/circles/[handle]/settings/about/actions.ts`, behind the
Settings/About page's "Publish circle" button for any `profile_child` circle) — neither checked
readiness before flipping `publishStatus` to `published`, so a freshly auto-provisioned artist
circle (default avatar, empty About, guidelines unsigned) could be published with zero edits,
defeating the point of `maybeAutoPublishPilotArtistCircle`'s gate. Scoping decision: gated only
circles with `metadata.peerify.autoProvisionedFromSignup === true`, not manually-created
(CircleWizard "Create" button) managed identities — those have never had a completion gate on
this button, so there's no existing gate for a manual click to defeat, and gating them now
would be an unrelated behavior change to that flow, not a bug fix. Extracted the shared bar into
`isPilotArtistCircleReadyToPublish` (`src/lib/data/circle.ts`, used by both the manual actions
and the existing auto-publish function) and enforced it server-side in both actions, with the
buttons also disabled client-side (`about/page.tsx`'s "Publish circle", and a new
`disabled`/`disabledReason` prop on `PublishManagedProfileButton`) as a UX nicety only — the
server side is what actually blocks it. Along the way, fixed `hasCustomPicture`
(`verification-readiness.ts`) to also recognize Peerify's own stock artist/band/venue/profile
avatar URLs as still-default (it previously only knew about the two generic legacy defaults),
since otherwise a circle that added About text but never swapped out its stock avatar would
have read as picture-complete and could have auto-published or manually published prematurely.

**Verification:** `bun run lint` and `CI=1 bun run build` both clean. No headless-browser
tooling available (same `libnspr4.so` blocker as prior sessions; Claude-in-Chrome extension not
connected in this environment either) — fell back to the established pattern of exercising the
real functions directly against throwaway documents in the staging DB (cleaned up after):
confirmed a fresh zero-edit auto-provisioned circle is blocked from manual publish; confirmed it
stays blocked once the artist circle's own picture/About are done but the creator's Community
Guidelines are still unsigned; confirmed signing the guidelines still correctly triggers
auto-publish afterward (no regression to the existing gate); confirmed a manually-created
identity's `autoProvisionedFromSignup` flag is correctly absent so the new gate never applies to
it. Deployed via `deploy-staging.sh` — all 8 steps passed; prod pid/uptime confirmed unaffected
throughout.

**Carry-forward:** none of this touches `main`/prod — staged only, matching this feature's
existing pattern of shipping to staging first. Confirmed live via the built bundle (new banner
copy string present in the staging static chunks) and the deploy script's own HTTP checks;
a human click-through on staging.peerify.one is still worth doing once browser tooling is
available, per the usual caveat.

---

## 2026-07-09 (cont.) — Simplified check-email popup; unified unverified-profile banners to plain red text; fixed Forum nested-reply phantom-success bug; kept the Unverified pill (confirmed functional)

Headline: Four items in one pass — two straightforward copy/style changes, one investigate-then-fix bug, one investigate-then-decide-to-keep. All four verified on staging via `deploy-staging.sh` (prod confirmed untouched throughout).

**1. Simplified the post-signup "Check your email" page** (`src/app/(auth)/signup/pilot/check-email/page.tsx`) — removed the "Recommended next step" box and the "Continue to Peerify"/"Back to login" buttons. Replaced with three short paragraphs (verification link sent to `[email]`; verification enables account recovery + may be asked for later; spam-folder note + an inline "click here to go directly to your profile" text link). The link reuses the `continueUrl` handle-based redirect logic already fixed earlier today (commit `2f4f32c9`) — confirmed unchanged and correct, no new redirect logic needed.

**2. Unified all "complete your profile" banners to plain red text.** This morning's amber-box restyle (`2f4f32c9`) was reverted in favor of the plain `text-sm text-destructive` treatment `ChatButton`'s `contactError` already used — same copy (`UNVERIFIED_PROFILE_EXPLAINER`), no box/border/background anywhere now. Touched `post-form.tsx`, `CommentSection.tsx` (both the top-level and nested-reply composer banners), and — after flagging it as a separate pre-existing inconsistency (a blue box, not amber) — `chat-room.tsx`'s `ChatInput` banner too, per founder direction to fold it into the same pass. Removed now-unused icon imports (`Info`, `IoInformationCircleOutline`) left over from the boxed versions.

**3. Investigated and fixed: unverified users could post a Forum nested reply (reply-to-a-reply) that appeared to succeed (visible immediately, timestamp + "Unverified" pill) but silently never persisted (gone on refresh).** Root cause: the Forum module (`discussions`, nav label "Forum") is a separate, largely-duplicated implementation of the comment/reply UI from the Noticeboard's (`src/components/modules/feeds/`) — `discussion-list.tsx`'s `CommentItem` had **no client-side verification gate at all** on replies (top-level or nested), unlike the already-correct `post-list.tsx`/`CommentSection.tsx`. The server (`createCommentAction` → `isAuthorized`, via `features.feed.comment`'s `needsToBeVerified`) was correctly rejecting the write the whole time — the bug was purely client-side: an optimistic local-state insert with no `else`/rollback branch when `result.success` was `false`, so the fake "posted" comment just sat in state until a refresh re-fetched the real list and it vanished. Fixed by mirroring the proven `CommentSection.tsx` pattern exactly: added a `canReply` check (`isAuthorized(user, circle, features.feed.comment)`), gated `handleAddReply`/the reply textarea render, added the failure-rollback + `UNVERIFIED_PROFILE_EXPLAINER` red-text banner (swapped in for the textarea when blocked). Also added the same banner to the Forum's top-level comment box, which previously just silently disappeared for unverified users with zero explanation (not exploitable the same way — the box is hard-gated off entirely — but inconsistent with "confirm banner styling is now consistent everywhere").

**4. Investigated: does the "Unverified" pill (`UserStatusBadge`) serve any real purpose on Peerify, or is it Kamooni-era cruft?** Confirmed it is *not* dead weight — `isVerified`/`verificationStatus` (which the pill visualizes) drives: feed-post visibility (unverified users' posts hidden from everyone but themselves), search/discoverability (`isDiscoverableCircle`), `getAllUsers`, platform stat counts, and — most importantly — is the literal signal for the `needsToBeVerified` authorization gate (`isAuthorized()`) enforced on every restricted action (posting, commenting, messaging, forum). The admin dashboard also has its own separate "Verified" pill + approve/reject actions. **Decision: keep the pill, no change made.**

**Verification:** `bun run lint` (no new errors, only pre-existing warnings) and `bun run build` both clean. Deployed via `deploy-staging.sh` (all 8 steps passed — build, BUILD_ID match, static-asset copy verified, staging restarted, prod pid/uptime confirmed unaffected, HTTP root + static-asset checks 200). Confirmed live via `curl` against `staging.peerify.one`: check-email page renders the new copy and the handle-based redirect link (`/circles/{handle}/home`); the old amber "Complete your profile" box markup no longer exists anywhere in the built JS bundle. **Caveat:** the reply-composer fix is a client-side rendering/state fix, and headless-browser click-through verification was not available in this environment (Playwright's Chromium still missing system shared libraries — `libnspr4.so` etc. — same blocker as 2026-07-08/07-09 sessions; `sudo apt install` declined again without explicit go-ahead). Verified instead via clean build + exact mirroring of the already-proven `CommentSection.tsx` gating pattern, not live click-through — flag for a future session if/when headless-browser tooling becomes available.

**Carry-forward:** none of this touches `main`/prod — still staged only, consistent with the existing item-16/17 promotion note in `PEERIFY_CONTEXT.md` §00.

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
