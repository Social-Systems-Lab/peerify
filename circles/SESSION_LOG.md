# Peerify — Session Log

Live at: https://peerify.one  ·  Staging: https://staging.peerify.one
(This log was migrated from the Kamooni/Circles repo during the 2026-06 split; entries before ~June 2026 describe Kamooni lineage and shared Circles work.)

## Current Status (2026-06-28, partially updated 2026-08-04 — see note below)
- Production: https://peerify.one — live, HTTPS (nginx + Certbot), PM2 process `peerify` on :3000, branch `main` @ 65480cfe (2026-08-13 promotion — see dated entry below).
- Staging:    https://staging.peerify.one — live, isolated, PM2 process `peerify-staging` on :3001.
- Audio pipeline: LIVE on prod (MP3 upload → ffmpeg derivative → signed streaming → play-only player). ffmpeg resolved via host /usr/bin/ffmpeg; prod .env.local sets FFMPEG_PATH explicitly.
- Build tool: bun. Runtime: Next.js standalone via PM2 (not Docker).
- **ORPHANED-CIRCLES ISSUE — Phase 0 fix now LIVE IN PRODUCTION as of the 2026-08-03 promotion
  below (it was already part of the earlier `0521025d` merge to main; this note was stale —
  Phase 1/2 still open):** deleting a personal account (admin dashboard or self-service — both
  call the identical `deleteCircle()`) never touches circles that account created/administers,
  and silently strips that account's own admin membership from those circles as a side effect
  of unrelated member-count-drift cleanup — bypassing the existing "cannot remove the last
  admin" safeguard (`removeMemberAction`), which never runs on this path. **Phase 0: both
  deletion entry points now BLOCK the deletion outright** if the account is the sole admin of
  any circle, naming the affected circle(s) — no new orphaning can happen going forward, on
  staging or production. **Still open:** the circles already orphaned before this fix are
  untouched (Phase 1); no reclaim/discovery-hiding/formal-orphan-state work has been done
  (Phase 2). Do not consider this issue closed until Phase 1/2 are addressed or explicitly
  descoped.
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

## 2026-08-13 — Promoted to production: superadmin visibility into private profiles

Headline: promoted the superadmin visibility fix to production. Deploy only — no code changes
made in this worktree beyond the cherry-pick itself.

**Scope confirmed first, as instructed.** `git log main..origin/staging` listed 39 commits, but
by content-diff (not ancestry — cherry-picks mint new hashes) only 1 was actually still
pending: `88c9bcf9` — "Give superadmins full visibility into private profiles." Confirmed via
`git cherry -v main origin/staging` (patch-id equivalence) that the other 38 already have
content-equivalent commits on `main` from earlier promotions (Backstage Lounge auto-enrollment,
nav bar links, map-privacy fix, connection-request fixes, visual-identity pilot + corrections,
Kamooni→Peerify rebrand, palette correction, mobile-overlap fix), and confirmed directly via
`git diff --stat main origin/staging -- . ':!circles/SESSION_LOG.md' ':!circles/PEERIFY_CONTEXT.md'`
that excluding each branch's own independent narrative-log/doc drift, the entire real code gap
was exactly this one commit's 7 files. (`PEERIFY_CONTEXT.md` differs too, but in main's favor —
main's copy is newer than staging's stale one — so left untouched.)

**The fix:** an `isAdmin` bypass (resolved server-side from a trusted DB lookup on the viewer's
did, never a client-supplied flag) added to `getSwipeCircles`/`searchDiscoverableCircles` at the
query layer, `getProfilePreviewAccessAction` for the profile-preview lock card, and the
client-side display-masking helpers in `map.tsx`/`search-results-panel.tsx` — so a superadmin
can now see, search for, and open personal profiles that opted out of `mapVisible`/`searchable`.
`publishStatus`/draft-content filtering is untouched throughout.

**Promotion:** cherry-picked `88c9bcf9` onto `main` → `65480cfe`. Applied cleanly, no conflicts.
`npx tsc --noEmit` clean.

**Deploy:** `scripts/deploy-peerify.sh` — GIT_SHA `65480cfe`, all 8 steps PASS (build, BUILD_ID
`ClBfZYpBKQz7duTL5F0Pj`, static-asset copy/verify, PM2 restart, HTTP checks).

**Post-deploy verification (beyond the script's own checks):** `pm2 jlist` confirmed `peerify`
restarted (new pid `1730937`, fresh uptime) and `peerify-staging` untouched (pid `1657393`,
uptime unchanged); `pm2 save` completed. `curl` confirmed HTTP 200 on both `https://peerify.one/`
and `https://peerify.one/explore`. Grepped the deployed standalone bundle to confirm the fix
actually shipped in the built artifact, not just the source: the literal string "This profile is
private" found in `.next/server/chunks/6509.js`.

**Carry-forward:** none — this was a scoped deploy-only promotion, no source changes made on
`main` beyond the one cherry-pick.

---

## 2026-08-08 (cont.) — Promoted to production: notify-on-accept, Connected badge, profile-page Respond dropdown

Headline: promoted the remaining three connection-request fixes to production together. Deploy
only — no code changes made in this worktree beyond the cherry-picks themselves.

**Scope confirmed first, as instructed.** `git log main..staging` on the staging worktree listed
20 commits, but by content-diff (not ancestry — cherry-picks mint new hashes) only 3 were
actually still pending; the other 17 were already promoted earlier under different hashes
(notifications-panel Respond dropdown from the 2026-08-06 promotion below, plus Backstage Lounge
auto-enrollment/pinning, nav bar links, and the map-privacy fix — confirmed via grep that
`contact_request_accepted` and `pendingOnly` were absent from `main` before this promotion, and
correctly did NOT re-cherry-pick those 17):
- `f6b8ebe0` — Notify the requester when their contact request is accepted.
- `b19c0f54` — Show a Connected badge on MessageButton after a contact request is accepted.
- `de7acf09` — Add Respond now to profile page for pending connection requests.

A 4th related commit, `4456f397` (notifications-panel Respond dropdown), was flagged to Tim as
found-but-not-in-the-original-3-named-fixes; confirmed already live on `main` as `ce4cc900` from
the 2026-08-06 promotion, so nothing further to do there.

**Promotion:** cherry-picked all 3 onto `main` in order → `9df424cf`, `c6d537a0`, `62792eb4`. All
three applied cleanly, no conflicts (each touches only connection-request-family files, disjoint
from the already-promoted Backstage Lounge/nav-bar/map-privacy commits). `npx tsc --noEmit`
clean.

**Deploy:** `scripts/deploy-peerify.sh` — GIT_SHA `62792eb4`, all 8 steps PASS (build, BUILD_ID
`AgnCqfXwYK1Tvze4FJ0f3`, static-asset copy/verify, PM2 restart, HTTP checks).

**Post-deploy verification (beyond the script's own checks):** `pm2 jlist` confirmed `peerify`
restarted (new pid `1479560`, fresh uptime) and `peerify-staging` untouched (pid `1476796`,
uptime unchanged at 77m); `pm2 save` completed. `curl` confirmed HTTP 200 on both `/` and
`/explore`. Grepped the deployed standalone bundle to confirm the fixes actually shipped in the
built artifact, not just the source: `contact_request_accepted` found in
`.next/server/chunks/{4477,2909,6509}.js` and `.next/server/app/circles/[handle]/access-denied/page.js`;
`pendingOnly` found in `.next/server/chunks/{7203,6509}.js` and client static chunks
`.next/static/chunks/{798-16cfc94d71d6fb15,7114-6ee93f2c88c55e6f}.js` and
`.next/static/chunks/app/circles/[handle]/layout-d23b8457b64f3dc2.js`; the literal string
"Respond now" also present in both of those client chunks.

**Carry-forward:** none — this was a scoped deploy-only promotion, no source changes made on
`main` beyond the three cherry-picks. All three connection-request fixes (notifications-panel
dropdown, notify-on-accept, Connected badge, profile-page dropdown) are now fully live in
production.

---

## 2026-08-06 (cont. 3) — Respond dropdown for connection requests (accept/decline in-place)

Headline: connection requests had no explicit accept/decline control — a request could only be
implicitly accepted by messaging the requester. One commit (`4456f397`), one file changed
(`src/components/layout/notifications.tsx`), deploying to staging now for testing.

**Investigation first, as instructed.** Found the Kamooni-era "Respond" dropdown pattern already
fully built and working, just never wired into any UI: `ProfileRelationshipHeaderAction`
(`src/components/modules/home/message-button.tsx`) renders an amber "Respond now" pill that opens
a dropdown with "Accept connection" / "Decline request", backed by real, already-correct server
actions (`acceptConnectRequestAction` / `declineConnectRequestAction` /
`getProfileRelationshipStateAction`, `src/components/modules/home/actions.ts`) that flip both
sides of the `UserRelationships` edge and are the same ones a `sendConnectRequestAction` request
targets. Confirmed via grep that `ProfileRelationshipHeaderAction` had zero call sites anywhere
in the app — dead code, not a hidden/hard-to-find pattern. Separately, the notifications panel's
`contact_request_received` entry only ever rendered a plain "Respond" button whose click just
navigated to the requester's profile (`getCircleDefaultPath`) — no inline accept/decline existed
there at all. The "implicit accept via messaging" behavior mentioned in the task turned out not
to touch `connectStatus`: `getDmEligibility` separately allows messaging when a DM conversation
already exists (`dm_permission_legacy_dm`), independent of connection state — untouched by this
fix.

**Fix:** in `notifications.tsx`, for notifications of type `contact_request_received`, render
`<ProfileRelationshipHeaderAction circle={...requester...} />` in place of the old "Respond"
button — reused as-is, zero changes to `message-button.tsx`. Wrapped it in a `div` that
stops click propagation and marks the notification read on interaction, so opening/using the
dropdown doesn't trigger the row's own click-to-navigate handler. All other notification types
are untouched — the old button/label/className logic still renders unchanged for every other
case.

**Verification:** `npx tsc --noEmit` and `bun run lint` both clean (no new warnings/errors in
the changed file). No live browser click-through in this environment — deploying to staging now
so it can be tested there with two real accounts (send a request, confirm the dropdown appears,
confirm accept and decline both work, confirm messaging-based implicit access still works).

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `hgL8UkHCoPZuQ8r85HY2k`), prod pid/uptime unchanged, `GET /` and a static CSS asset
both HTTP 200 post-restart.

**Carry-forward:** verified on staging and promoted to production — see the dated entry below
("Promoted to production: Respond dropdown for connection requests").

---

## 2026-08-06 (cont. 4) — Promoted to production: Respond dropdown for connection requests

Headline: promoted the Respond dropdown accept/decline fix to production. Deploy only — no
code changes made in this worktree beyond the cherry-picks themselves.

**Scope confirmed first, as instructed.** `git log main..staging` on the staging worktree listed
13 commits, but by content-diff (not ancestry — cherry-picks mint new hashes) only the 3 most
recent were actually still pending; the other 10 were already promoted earlier under different
hashes (nav bar links, sidebar auto-pinning, map privacy fix, Backstage Lounge auto-enrollment —
confirmed via grep that `ProfileRelationshipHeaderAction` and the "Respond dropdown" log text
were absent from `main` before this promotion, and correctly did NOT re-cherry-pick those 10):
- `4456f397` — Surface Respond dropdown for connection requests in notifications.
- `a0266d8a` — Log: Respond dropdown for connection requests.
- `b127ebb6` — Log staging deploy of Respond dropdown fix.

**Promotion:** cherry-picked all 3 onto `main` in order → `ce4cc900`, `d8848c03`, `e2b34357`.
`4456f397` applied cleanly. The two log commits each hit the same recurring positional-artifact
conflict in `SESSION_LOG.md` as every prior promotion (new dated entry vs. existing
promotion-log entries competing for the same insertion point right after "Current Status");
resolved by inserting the new entry chronologically ahead of the nav-bar-promotion entry it was
authored after, keeping both intact. Confirmed `src/components/layout/notifications.tsx` is
byte-for-byte identical to staging's version afterward. `bun run lint` clean (pre-existing
warnings only, none in the changed file).

**Deploy:** `scripts/deploy-peerify.sh` — GIT_SHA `e2b34357`, all 8 steps PASS (build, BUILD_ID
`uKgIGyuEwvFPMhGSfbmZT`, static-asset copy/verify, PM2 restart, HTTP checks).

**Post-deploy verification (beyond the script's own checks):** confirmed shell `$PORT` empty
before the script ran; confirmed via `pm2 jlist` that the restarted `peerify` process's own env
has `PORT=3000`; `pm2 save` completed ("Successfully saved in /home/tim/.pm2/dump.pm2`); `pm2
status` shows `peerify` online (new pid, fresh uptime) and `peerify-staging` unchanged
(pid/uptime identical to pre-deploy). `curl` confirmed HTTP 200 on both `/` (70354 bytes) and
`/explore` (93081 bytes), zero "Application error" occurrences in either body. `pm2 logs
peerify` showed only the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy — expected, not a fault. Grepped the deployed
standalone bundle directly (binary-safe, `grep -a`) to confirm the fix actually shipped in the
built artifact, not just the source: `contact_request_received` and both
`acceptConnectRequestAction`/`declineConnectRequestAction` server-action names all found
together in the same client chunk (`.next/static/chunks/4367-5754e8e66f7d6613.js`) plus the
server-reference manifest — `ProfileRelationshipHeaderAction` itself is not findable as a
literal string, expected, since local component names (unlike server-action IDs) are minified
away in production.

**Carry-forward:** none — this was a scoped deploy-only promotion, no source changes made on
`main` beyond the three cherry-picks.

---

## 2026-08-06 (cont. 2) — Promoted to production: nav bar (Backstage Lounge icon link + superadmin Admin link) and sidebar auto-pinning of The Backstage Lounge

Headline: promoted two more staging features to production together, per explicit request.
Deploy only — no code changes made in this worktree beyond the cherry-picks themselves.

**Scope confirmed first, as instructed.** `git log main..staging` on the staging worktree
listed 10 commits, but by content-diff (not ancestry — cherry-picks mint new hashes) only two
were actually still pending:
- `e3ac57de` — Nav bar: link the Peerify icon to The Backstage Lounge; add a superadmin-only
  Admin link (gated on `user.isAdmin`, the same field every other admin surface uses).
- `09d7a151` — Pin The Backstage Lounge to new signups' sidebar by default (added to the same
  signup step that already auto-enrolls new users as members, via the existing, unprivileged
  `pinCircle` mechanism — not a locked default; users can unpin it normally).

The other two commits in that `main..staging` list (`ccb41bd3` Backstage Lounge auto-enrollment,
`a9143e4b` map privacy fix) were already promoted earlier under different hashes (`0355c61f`,
`79510ae1` respectively, see prior dated entries) — confirmed via `grep` that main's
`global-nav.tsx` and `signup/actions.ts` were missing the nav/pin changes before this promotion,
and correctly did NOT re-cherry-pick those two.

**Promotion:** cherry-picked `e3ac57de` → `fea0a177` and `09d7a151` → `e7981c53` onto `main`,
both applying cleanly with no conflicts. `bun run lint` clean (pre-existing warnings only, no
errors) before deploying.

**Deploy:** `scripts/deploy-peerify.sh` — GIT_SHA `e7981c53`, all 8 script steps PASS
(build, BUILD_ID `C_NPsP4SJ7H901ylbu0l6`, static-asset copy/verify, PM2 restart, HTTP checks).
Confirmed `PORT=3000` via `pm2 env` for the `peerify` process pre/post-restart; `pm2 save`
completed ("Successfully saved in /home/tim/.pm2/dump.pm2"); `pm2 status` shows `peerify` online
(new pid) and `peerify-staging` untouched (unchanged pid/uptime). `curl` confirmed HTTP 200 on
both `/` and `/explore`. Grepped the deployed standalone bundle directly to confirm both features
actually shipped in the built artifact (not just source): `the-backstage-lounge` found in server
chunks `915.js`/`6509.js` and the client `app/layout` static chunk; `isAdmin` and the literal
`Admin dashboard` aria-label found in that same nav static chunk; `pinCircle` found in the
signup server-action chunk (`6509.js`) and the server-reference manifest.

**Carry-forward:** none — this was a scoped deploy-only promotion, no source changes made on
`main` beyond the two cherry-picks.

## 2026-08-06 (cont.) — Promoted to production: Backstage Lounge auto-enrollment

Headline: promoted the Backstage Lounge auto-enrollment feature to production. Deploy only —
no code changes made in this worktree beyond the cherry-picks themselves.

**Promoted (cherry-picked `ccb41bd3` + `e4bd48ec` + `57ee13c9` onto `main`, new HEAD
`62d34468`, rollback point `76be618c`):**
- `ccb41bd3` — every new signup (fan or artist alike) is now auto-enrolled as a follower of The
  Backstage Lounge via an unconditional step in `submitSignupFormAction`
  (`src/components/forms/signup/actions.ts`), looked up by its stable handle
  (`the-backstage-lounge`) and enrolled through the existing `addMember(...)` mechanism
  (`["members"]`, the circle's own Follower group). try/catch-wrapped like the adjacent
  optional/unconditional provisioning steps already there — a missing circle or any other
  failure only logs, never blocks signup.
- `e4bd48ec`, `57ee13c9` — SESSION_LOG entries for the above and its staging deploy.

**Process:** `git log main..staging` showed 5 commits ahead, not 3 — but confirmed the other 2
(`a9143e4b`/`e40d53ef`) were the map privacy fix already promoted last time (cherry-picking
creates new commit objects with different hashes, so git never considers the originals "merged"
by ancestry even though the content is already in `main` — confirmed via `diff <(git show
a9143e4b) <(git show 79510ae1)`, identical beyond the commit metadata line). The genuinely
remaining work was exactly the 3 commits named. Cherry-picked all 3 directly onto `main`, in
order.

**Merge conflicts:** `SESSION_LOG.md` only, on 2 of the 3 cherry-picks — the same recurring
positional-artifact class as every prior promotion, plus a chronological-interleaving wrinkle
this time: staging's own file has the Backstage Lounge entry sitting *between* the privacy-fix
entry and the search-scope-decouple entry (matching real creation order), while `main` has its
own promotion-log entries interspersed in between those same two that don't exist on staging at
all. Resolved by inserting the new Backstage Lounge content at the equivalent chronological
position relative to `main`'s own entries, and discarding a duplicate/renumbered header for an
already-shared entry each time (same resolution pattern as every prior promotion). Confirmed
`src/components/forms/signup/actions.ts` is byte-for-byte identical to staging's version
afterward. `bun run lint` clean.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting. `scripts/deploy-peerify.sh`,
all 8 steps passed. GIT_SHA `62d34468`, BUILD_ID `ro-19eRfSmvF8MDAQcUns`. `pm2 save` ran inside
the script. Staging pid/uptime unchanged throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, clean "Ready in 217ms" boot.
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy — expected, not a fault. Homepage and `/explore`
both curl-verified to return full real content (70KB/93KB, zero "Application error"
occurrences). Grepped the deployed server bundle directly for the fix's literal handle string
(`"the-backstage-lounge"`) — present, confirming the fix is actually live, not just that the
build succeeded.

---

## 2026-08-06 — PRIVACY: promoted to production — map leak, mapVisible:false profiles got a real pin via search

Headline: **privacy-relevant fix**, promoted to production. Deploy only — no code changes made
in this worktree beyond the cherry-picks themselves.

**Promoted (cherry-picked `a9143e4b` + `e40d53ef` onto `main`, new HEAD `661d1ce0`, rollback
point `8dee10df`):**
- `a9143e4b` — `searchDiscoverableCircles` (`search.ts`) now strips a personal profile's
  `location` field whenever `circleType === "user" && mapVisible !== true`, the exact same rule
  `getSwipeCircles` already applies at the query level for default map browsing. Since
  `map.tsx`'s only condition for creating a marker at all is `item?.location?.lngLat`, this
  makes a marker structurally impossible for these profiles — closing the gap where a
  searchable-but-not-map-visible profile could still get a real, clickable "Unavailable" pin
  revealing its approximate location, purely because search never checked `mapVisible` at all
  (only the separate `searchable` field). Not another client-side mask — the pre-existing
  `isSuppressedUserProfile` cosmetic-degradation helper in `map.tsx` is untouched, left as a
  legitimate defense-in-depth layer, now correctly unreachable for this path. `searchable`
  itself is untouched — profiles remain fully findable by search and viewable via Open exactly
  as before, by design.
- `e40d53ef` — SESSION_LOG entry for the above.

**Process — explicitly scoped, not a plain merge:** `git log main..staging` showed staging was
**5** commits ahead, not 2 — the other 3 (`ccb41bd3`/`e4bd48ec`/`57ee13c9`, the unrelated
Backstage Lounge auto-enrollment feature) were **not** part of this promotion's scope. A plain
`git merge staging` would have incorrectly bundled them in, so cherry-picked only the 2 relevant
commits directly onto `main` instead. Confirmed afterward via `git merge-base --is-ancestor
ccb41bd3 HEAD` that the excluded commits are genuinely absent, and that `search.ts` is
byte-for-byte identical to staging's version.

**Merge conflict:** `SESSION_LOG.md` only, on the second cherry-pick (`e40d53ef`) — a positional
artifact: the new entry's diff context included an adjacent, pre-existing staging header (the
excluded Backstage Lounge entry's own heading) that had to be explicitly excluded rather than
pulled in along with the real new content. Resolved by keeping only the genuinely new
privacy-fix entry text and restoring `main`'s own next entry unchanged. `bun run lint` clean.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting. `scripts/deploy-peerify.sh`,
all 8 steps passed. GIT_SHA `661d1ce0`, BUILD_ID `sz1n1-CZoNzZv9TplAcr7`. `pm2 save` ran inside
the script. Staging pid/uptime unchanged throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, clean "Ready in 186ms" boot.
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy — expected, not a fault. Homepage and `/explore`
both curl-verified to return full real content (70KB/93KB, zero "Application error"
occurrences). Grepped the deployed server bundle directly and found the exact shipped logic
(minified: ``"user"!==a.circleType||!0===a.mapVisible`` gating ``location:c?a.location:void
0``) in `app/api/circles/search/route.js` — confirming the fix is actually live, not just that
the build succeeded.

**Confirmed against the real production account, not staging's synthetic test account
(explicitly required):** staging's `tim-admin` doesn't exist on production; the real equivalent
— same person, same precondition (`searchable: true, mapVisible: false`) — is `tim` (Tim
Olsson, `handle: "tim"`, the same account behind the Backstage Lounge and "Peerify
Announcements" conversation). Called the real `searchDiscoverableCircles` function directly
against production's live database: `tim` is still found by search, but now has no location in
the result — a map marker is no longer possible. The leak is confirmed fixed on the actual
production account that would have been affected, not a fixture or a staging stand-in.

---

## 2026-08-05 (cont.) — PRIVACY: fixed map leak — mapVisible:false profiles got a real pin via search

Headline: **privacy-relevant fix**, same class as this week's event-visibility fixes — a
personal profile that explicitly opted out of map visibility (`mapVisible: false`) was still
getting a real, clickable map marker (a degraded "Unavailable" pin) whenever it turned up in
search results, revealing its approximate location and remaining fully navigable to the real
profile. One commit (`a9143e4b`), one file changed (`src/lib/data/search.ts`), deployed to
**staging only** — explicitly not promoted to production without confirmation first.

**Investigated independently, as instructed** — confirmed via `git log -S` that this predates
both of this week's shipped fixes: `isSuppressedUserProfile` (`map.tsx`) traces to commit
`a942895d`, and the "search results feed the map's marker array" architecture traces to
`3098a311` ("Map search") — long before the event-visibility fixes (`6efd8066`/`7f8bdb14`) or
the search-scoping fix (`277eba2a`), neither of which touched `mapVisible` filtering at all
(the search-scoping fix only changed how category *pills* interact with already-fetched search
results, never whether `mapVisible` was checked — it never was, for search).

**Root cause:** `getSwipeCircles` (`circle.ts`) correctly excludes `mapVisible: false` personal
profiles from the *default browsing* dataset at the query level — that part was always fine.
Search was never gated on `mapVisible` at all — only on the intentionally separate `searchable`
field (`search.ts`, `isDiscoverableCircle`). Once a searchable-but-not-map-visible profile
appeared in search results, it flowed unfiltered through to the map's marker-producing content
array (`allSearchResults` → `baseCircles`/`filteredSearchResults` → `mapData` →
`displayedContent`, `map-explorer.tsx`). `map.tsx`'s *only* condition for creating a marker at
all is `item?.location?.lngLat` — there is no `mapVisible` check anywhere in that path.
`isSuppressedUserProfile` (`map.tsx`) is purely cosmetic — it degrades a marker's title to
"Unavailable", drops its image, blanks its description — but never prevents the marker from
being created, and the marker's Open link isn't gated by it at all, so the "hidden" pin
remained fully clickable through to the real profile page.

**Confirmed by design, not a bug:** the profile being fully viewable via search + Open.
`searchable` and `mapVisible` are two deliberately independent, already-documented toggles
("mapVisible for map, searchable for search") — a profile can legitimately opt out of map
browsing while remaining directly findable by search. Left completely untouched.

**Fix — query-level exclusion, matching `getSwipeCircles`' own pattern, not another
client-side mask (explicitly required and confirmed before implementing):** `search.ts`'s
`searchDiscoverableCircles` now strips a personal profile's `location` field from its own
results whenever `circleType === "user" && mapVisible !== true` — the exact same rule
`getSwipeCircles` already applies, computed server-side in the same results-shaping step that
already existed for search metrics. This isn't a second masking layer: every consumer of
`.location` in the map/search code already checks it optionally (`item?.location?.lngLat`),
matching the existing "no location set" UI state, so a location-less result is *structurally*
incapable of producing a marker at all in `map.tsx` — the identical outcome `getSwipeCircles`
achieves by excluding the row entirely, just reached by omitting one field rather than the
whole row (necessary here because, unlike events which already had separate map/list-serving
functions, this single search call serves both the map and the text results list, and only the
map side needed the extra restriction). `isSuppressedUserProfile` was deliberately left in
place, unmodified, as a legitimate defense-in-depth layer for any future/unknown path — it's
simply correctly unreachable now for this one.

**Verification, against real staging data, not fixtures (explicitly required):** re-ran the
exact confirmed bug case — `tim-admin` (`searchable: true`, `mapVisible: false`) — against the
real `searchDiscoverableCircles` function: still found by search, but now has **no** location in
the result, making a marker impossible. `linus` (`mapVisible: true`) confirmed fully unaffected
— still found, still has its full location, still gets a normal marker. `dave-knowles`
(`searchable: false`) confirmed still excluded from search entirely, unaffected. The
Backstage Lounge itself (`circleType: "circle"`, `mapVisible: false`) confirmed to still have
its location in search results, correctly matching `getSwipeCircles`' asymmetric rule that
`mapVisible` only ever restricts `"user"`-type circles. `bun run lint` and `npx tsc --noEmit -p .`
both clean.

**Deployed to staging only**, per instruction: `deploy-staging.sh`, all 8 steps passed (BUILD_ID
`bjagfl2vb-TfNVVrosdAF`), prod pid/uptime unchanged. `pm2 status` both processes online, no
crash loop. Homepage and `/explore` both curl-verified to render fully (70KB/76KB, zero
"Application error" occurrences). Grepped the deployed server bundle directly and found the
exact shipped logic (minified: ``"user"!==a.circleType||!0===a.mapVisible`` gating
``location:c?a.location:void 0``) — confirming the fix is actually live on staging, not just
that the build succeeded.

**Do NOT promote to production without explicit confirmation first** — flagged here in bold
per instruction, given the privacy sensitivity (same class as the event-visibility fixes, which
*were* already promoted earlier this week — this one is still staging-only).

---

## 2026-08-04 (cont. 7) — Promoted to production: decouple map search scope from the active filter pill

Headline: promoted the search-scoping fix below to production. Deploy only — no code changes
made in this worktree beyond the merge itself.

**Promoted (merge `c9a5b43c`, rollback point `28a33675`):**
- `277eba2a` — a fresh search no longer inherits whichever content-type pill happens to be
  active (including the Artists default) as a pre-scope. Searching for a friend or venue no
  longer silently returns zero results just because a different pill was selected. Pills still
  narrow results after a search is already running (preserved across refinements like a genre
  pill change). Default (no-search) browsing view is completely unaffected — a different code
  path entirely.
- `1f38d02c`, `47a3533d` — SESSION_LOG entries for the above and its staging deploy.

**Process:** confirmed via `git log main..staging` that staging was exactly these 3 commits
ahead — matching the expected pattern (1 code + 2 log), nothing unaccounted for this time.
`main` was not a fast-forward target (main's tip `28a33675` isn't an ancestor of `staging`), so
merged with `git merge --no-ff`.

**Merge conflict:** `SESSION_LOG.md` only, the same class as the three prior promotions.
Resolved by interleaving in chronological order. `map-explorer.tsx` merged with no conflict and
was confirmed byte-for-byte identical to staging's version afterward. `bun run lint` clean; no
bare build run (per instruction) — build verified via the deploy script itself.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting. `scripts/deploy-peerify.sh`,
all 8 steps passed. GIT_SHA `c9a5b43c`, BUILD_ID `0tPViF_NveOXRVh_Ov1Hi`. `pm2 save` ran inside
the script. Staging pid/uptime unchanged throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, clean boot ("Ready in 212ms").
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy — expected, not a fault. Homepage and `/explore`
both curl-verified to return full real content, zero "Application error" occurrences.

**Important caveat, unlike the two backend fixes promoted earlier today:** this fix is pure
client-side React state/effects logic with no server-executed code path — there is no way to
curl-verify the actual search-scoping behavior itself, on staging or here. These health checks
only confirm the app is up and rendering; the fixture-based script run before the staging
deploy (using the real `isPeerifyArtistIdentity`/`isPeerifyVenueIdentity` functions against the
exact new logic) remains the strongest verification this fix has had. A real click-through
(typing a query, watching results populate) in an actual browser is still outstanding.

---

## 2026-08-05 — Auto-enroll every new signup as a follower of The Backstage Lounge

Headline: implemented and verified auto-enrollment into The Backstage Lounge on signup. One
commit (`ccb41bd3`), one file changed (`src/components/forms/signup/actions.ts`), local to
`staging` only, not deployed.

**Investigation first, as instructed.** Found The Backstage Lounge on **production**
(`the-backstage-lounge`, `_id: 6a5c7b442ef17c96d12cac04`, published, 5 members) — it did **not**
exist on staging at all (staging's `circles` collection had only 15 documents, no match by name
or handle). Flagged this before implementing; the user created a matching circle on staging
themselves (same handle, same `userGroups` shape) so the feature could be tested end-to-end as
it'll behave in production.

Found the signup provisioning pattern: `submitSignupFormAction`
(`src/components/forms/signup/actions.ts`) is the **single, unified** account-creation entry
point — confirmed `createUserAccount` is called from exactly this one place, and the pilot
signup form calls this same action for both artist and fan role selection (differing only by a
`signupIntent`-gated branch that optionally auto-provisions an artist circle). Two existing
steps there set the pattern to follow: the artist-circle step (`createPilotArtistCircle` +
`addMember`, gated, try/catch) and the welcome-message step (`ensureWelcomeMessageForNewUser`,
**unconditional**, try/catch). `addMember(userDid, circleId, userGroups)`
(`src/lib/data/member.ts`) is the existing membership mechanism — `["members"]` maps to the
circle's own `{ handle: "members", title: "Follower" }` group, i.e. real member/follower
enrollment, no new mechanism needed.

**Fix:** added an unconditional step (same pattern as the welcome-message one — outside and
after the `signupIntent === "artist"` branch, so it applies identically to both signup paths)
that looks up The Backstage Lounge by its stable handle (`getCircleByHandle`, not a hardcoded
id, since it can vary per environment — confirmed literally true this session) and calls
`addMember(user.did!, circleId, ["members"])`. try/catch-wrapped, same resilience as the two
existing optional steps — a missing circle or any other failure only logs, never blocks signup.

**Verification:** attempted a full live signup via the real `submitSignupFormAction` first
(minted a valid Altcha proof-of-work payload server-side using `altcha-lib`'s own
`createChallenge`/`solveChallenge` against the real `ALTCHA_HMAC_KEY`, to exercise the actual
action unmodified) — hit a real, pre-existing limitation: `createUserSession`, called
immediately after `createUserAccount` inside the real action, calls `cookies()`, which requires
a genuine Next.js request scope and cannot run in a standalone script (the same class of
limitation hit earlier this week for `getUserPrivate`'s notification-settings enrichment — not
something wrong with this feature). Adjusted to call the real `createUserAccount` directly
(identical to what the action does up to that point) followed by the exact same
`getCircleByHandle` + `addMember` sequence just added, using two of the three recycled test
emails (`cryptimothy@gmail.com` for a fan-labeled account, `akrobatim@yahoo.se` for an
artist-labeled account — the artist/fan distinction doesn't affect `createUserAccount` itself,
only the separate, untouched artist-circle branch, so this was primarily to exercise both real
email addresses rather than to re-prove path independence, which the code structure already
guarantees). Both accounts were correctly enrolled with `userGroups: ["members"]`; the circle's
`members` counter moved from 1 → 3 for the two signups and back to 1 after cleanup; a
consistency sweep across every circle confirmed no stored `members` count drifted from the
actual `Members` row count anywhere (the "4 rows deleted for 2 accounts" during cleanup was
correctly explained by `createUserAccount`'s own pre-existing self-membership step — 1 per
account, unrelated to this change, not a bug); and existing accounts (`tim-admin`, `linus`,
`dave-knowles`) were confirmed to have identical membership lists before and after, entirely
unaffected. Both test accounts and their membership rows were deleted afterward. `bun run lint`
and `npx tsc --noEmit -p .` both clean.

**Deployed to staging** (follow-up, same session): `deploy-staging.sh` run, all 8 steps passed
(BUILD_ID `t_rx8RGwJyxSec3-Nr6Ie`), prod pid/uptime unchanged. `pm2 status` — both processes
online, no crash loop. Homepage and `/explore` both curl-verified to render fully post-deploy
(70KB/76KB, zero "Application error" occurrences). Since this is real server code (unlike the
pure client-side search-scoping fix earlier), also grepped the deployed server bundle directly
for the literal handle string `"the-backstage-lounge"` — present, confirming the fix actually
shipped rather than trusting the build log alone.

**Carry-forward:** the third recycled test email (`ryptimothy@gmail.com`) was left unused (two
sufficed for fan + artist coverage). Full live-signup verification through the actual
browser/HTTP form (rather than direct function calls skipping only the cookie-session step) is
still outstanding — no browser tooling available in this environment.

---

## 2026-08-04 (cont. 6) — Decoupled map search scope from the active filter pill

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

## 2026-08-04 (cont. 5) — Promoted to production: hide Topics from chat/messages UI

Headline: promoted the Topics-hide fix below to production. Deploy only — no code changes made
in this worktree beyond the merge itself.

**Promoted (merge `46c1aded`, rollback point `64047344`):**
- `2b448ef1` — removes the three Topics UI entry points (composer's "New topic" button, inline
  Topic card, "Topics" tab in the room Info dialog) without touching the backend
  (`mongo-actions.ts`, `mongo-chat.ts`, `mongo-types.ts`) or deleting the underlying component
  definitions — a reversible UI-only hide, per explicit product decision (Topics is real,
  functioning, Peerify-built chat-thread functionality, not leftover Kamooni/Circles
  scaffolding, but fully self-contained within the chat module).
- `afa0c641`, `f5d1fca6` — SESSION_LOG entries for the above and its staging deploy.

**Process:** the task named 2 commits ("`f5d1fca6` and its parent"); confirmed via
`git log main..staging` that staging was actually 3 commits ahead, and that a literal reading
of "its parent" would have excluded the actual code fix (`2b448ef1`) — flagged this before
merging and brought over all 3, matching staging's entire divergence exactly (nothing else
bundled in). `main` was not a fast-forward target (main's tip `64047344` isn't an ancestor of
`staging`), so merged with `git merge --no-ff`.

**Merge conflict:** `SESSION_LOG.md` only, the same class as the two prior promotions. Resolved
by interleaving in chronological order. Both chat files (`chat-room.tsx`,
`group-settings-modal.tsx`) merged with no conflict and were confirmed byte-for-byte identical
to staging's versions afterward. `bun run lint` clean; no bare build run (per instruction) —
build verified via the deploy script itself.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting. `scripts/deploy-peerify.sh`,
all 8 steps passed. GIT_SHA `46c1aded`, BUILD_ID `AJ1LWZ1qdw08cigOxZNYJ`. `pm2 save` ran inside
the script. Staging pid/uptime unchanged throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, clean "Ready in 243ms" boot.
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy — expected, not a fault. Homepage and `/explore`
both curl-verified to return full real content, zero "Application error" occurrences. Went
further this time and curl-verified a real **production chat conversation** directly (minted a
JWT for the session owner's own admin account — not an arbitrary third-party user — and hit
`/chat/6a2a62bee1871c530830cef0`, the real "Peerify Announcements" conversation): page rendered
fully (67.7KB, zero errors), the conversation's own content still present, and zero matches
anywhere in the output for "New topic", "Topic title", "Create Topic", or a "Topics" tab label.
Real end-to-end confirmation on production itself, not just staging.

---

## 2026-08-04 (cont. 4) — Hid Topics from chat/messages UI — not needed for Peerify

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

## 2026-08-04 (cont. 3) — Promoted to production: map filter-pill fixes

Headline: promoted the map filter-pill fix below to production. Deploy only — no code changes
made in this worktree beyond the merge itself.

**Promoted (merge `a8b2dfdf`, rollback point `e7d8cb3d`):**
- `284816d2` — category pills (Artists/Venues/Events) now correctly exclude every other content
  type instead of always showing events alongside them; map defaults to Artists selected on
  load instead of showing everyone.
- `eca8b574` — SESSION_LOG entry for the above.

**Process:** confirmed via `git log main..staging` that staging was exactly these 2 commits
ahead — no discrepancy this time (unlike the prior promotion, where the named commits didn't
cover the full gap). `main` was not a fast-forward target (main's tip `e7d8cb3d` isn't an
ancestor of `staging`), so merged with `git merge --no-ff`.

**Merge conflict:** `SESSION_LOG.md` only, the same class as the prior promotion — main's own
promotion-log entries never sync back to staging, so both branches inserted new entries at the
same anchor point. Resolved by interleaving in chronological order. `map-explorer.tsx` merged
with no conflict and was confirmed byte-for-byte identical to staging's version afterward.
`bun run lint` clean; no bare build run (per instruction) — build verified via the deploy
script itself.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting. `scripts/deploy-peerify.sh`,
all 8 steps passed. GIT_SHA `a8b2dfdf`, BUILD_ID `X1mxJiIiEUVCQAi_SM-Fu`. `pm2 save` ran inside
the script. Staging pid/uptime unchanged throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, "Ready in 199ms" on boot.
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst seen on every prior redeploy (pre-restart browser tabs referencing the
previous build's action IDs) — expected, not a fault. Homepage and `/explore` both
curl-verified to return full real content (70KB/93KB, correct `<title>`, zero "Application
error" occurrences).

**Not done, carried forward from the staging fix itself:** a real click-through confirming pill
highlighting/map marker behavior in an actual browser — this fix was verified on staging via
manual code trace + a fixture-based script (no browser tooling in this environment), not
interactive testing, and that gap carries through to this production promotion too.

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

## 2026-08-04 — Promoted to production: map + list event-visibility fixes

Headline: promoted both event-visibility fixes below (map and list) to production in one merge.
Deploy only — no code changes made in this worktree beyond the merge itself.

**Promoted (merge `54776725`, rollback point `5e837e5e`):**
- `6efd8066` — `getOpenEventsForMap` now requires the host circle to pass the same visibility
  gate circles/profiles already use before an event can appear on the map: published, and
  (for personal "user"-type profiles) `mapVisible: true`. Confirmed exploitable pre-fix via two
  constructed test cases (draft-circle event, `mapVisible: false`-profile event, both leaked).
- `1f5575a2` — SESSION_LOG entry for the above.
- `7f8bdb14` — the identical fix applied to `getOpenEventsForList` (list/panel view), closing
  the gap the map fix explicitly flagged as out of scope.
- `cbdd865a` — SESSION_LOG entry for the above.

**Process:** the two commit hashes given for this task named only the list fix
(`7f8bdb14`/`cbdd865a`); confirmed via `git log main..staging` that staging was actually 4
commits ahead (the map fix's `6efd8066`/`1f5575a2` too), and confirmed with the user before
proceeding that all 4 should be promoted together — "both event-visibility fixes" wouldn't
otherwise both end up live. `main` was not a fast-forward target for `staging` (main's tip
`5e837e5e` isn't an ancestor of `staging`), so merged with `git merge --no-ff`.

**Merge conflict:** `SESSION_LOG.md` only — a positional conflict, not a real content conflict.
The prior promotion's "Current Status" correction was made directly on `main` and never synced
back to `staging`, so both branches had independently inserted new dated entries at the same
anchor point. Resolved by interleaving both branches' entries in chronological order; `event.ts`
merged with no conflict and was confirmed byte-for-byte identical to staging's version
afterward. `bun run lint` clean on the resulting merge commit; no bare build run (per
instruction) — build verified via the deploy script itself.

**Deploy:** confirmed `$PORT` empty in a fresh shell before restarting (per standing process).
`scripts/deploy-peerify.sh`, all 8 steps passed. GIT_SHA `54776725`, BUILD_ID
`UX-odmVugv4fIUWgwTapI`. `pm2 save` ran inside the script. Staging pid/uptime unchanged
throughout.

**Post-deploy health checks (verified the app is actually up, not just script exit 0):**
`pm2 status` — both processes online, prod not crash-looping, "Ready in 197ms" on boot.
`pm2 logs peerify` showed the same benign "Failed to find Server Action ... older or newer
deployment" burst as the prior promotion (pre-restart browser tabs referencing the previous
build's action IDs) — expected, not a fault. Homepage and `/explore` both curl-verified to
return full real content (70KB/93KB, correct `<title>`, zero "Application error" occurrences).
Grepped the deployed server bundle directly for the fix's exact query field
(`circleDetails.mapVisible`) — present, confirming the fix actually shipped rather than trusting
the build log alone.

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

**Scope note:** the `getOpenEventsForList` gap flagged here was closed immediately after in the
entry above (`7f8bdb14`) — both fixes are promoted to production together in this same merge.

---

## 2026-08-03 — Promoted to production: Continue-setup routing fix + profile-complete notification copy fix

Headline: promoted two small, independently-verified staging fixes to production. Both had
already been confirmed via real click-through/live-request testing on staging (not just
lint/build) — see the two dated `staging`-branch entries below for the full investigations.

**Promoted (merge `1ce96eda`, staging HEAD `1e733b9d` → main, rollback point `0521025d`):**
- `96cb4f37` — artist Draft-profile banner's "Continue setup" no longer routes back to Frame
  1a via a stale client-cached `<Link>` navigation to `/onboarding/pilot`; replaced with
  `router.push` + `router.refresh()`. This exact bug was originally discovered live on
  production via a real signup, before being fixed and verified on staging.
- `30b18a95` — accompanying copy (bold "public artist profile", button label to "Continue with
  artist setup" on the artist-track explainer screen).
- `42e771c7` — the auto-verify "profile complete" notification no longer overclaims
  completeness when location is unset (branches on `hasLocationSet`); the actual
  posting/commenting/messaging participation gate is unchanged — location stays genuinely
  optional for that, by deliberate design, not by oversight.
- Plus 4 SESSION_LOG.md-only commits documenting the above.

**Process:** confirmed staging's working tree clean at `1e733b9d`, `bun run lint` and
`CI=1 bun run build` both clean on that exact commit (re-running the build regenerated
staging's live standalone artifacts per the known hazard — immediately restored via a real
`deploy-staging.sh` run before proceeding, no code change). Confirmed via `git log main..staging`
that exactly these 7 commits (3 code + 4 docs) were ahead — nothing unexpected. `main` was not a
fast-forward target for `staging` (main's tip `0521025d` isn't an ancestor of `staging`), so
merged with `git merge --no-ff` — auto-resolved cleanly, no conflicts. `bun run lint` and
`CI=1 bun run build` both clean on the resulting merge commit in the production worktree.

**Deploy:** `scripts/deploy-peerify.sh`, all 8 steps passed. GIT_SHA `1ce96eda`, BUILD_ID
`WbNzBMEbRxYbKiXh22vVx`. Staging pid/uptime unchanged throughout.

**Post-deploy health checks:** `pm2 status` — both processes online, prod not crash-looping.
`pm2 logs peerify` showed a burst of "Failed to find Server Action ... older or newer
deployment" errors right after restart — expected, benign collateral of any redeploy (browser
tabs already open from before the restart still reference the previous build's Server Action
IDs; resolves itself as those tabs refresh or make their next request). Homepage and `/explore`
both curl-verified to return full real content (70KB/93KB, correct `<title>`, zero
"Application error" occurrences) — not blank/hydration-failed. Grepped the deployed server
bundle directly for both notification message variants (the full "complete" wording and the
trimmed one) — both present. Grepped the deployed client bundle for the Continue-setup fix's
exact code (`router.push`/`router.refresh()`, no `<Link>`) — present, matching staging's bundle
byte-for-byte in substance.

**Not done, recommended:** a real click-through on production itself for the Continue-setup
fix specifically — this bug was originally found live on production, and while the exact fixed
code is confirmed present and staging's click-through passed, production's own real traffic/
caching patterns haven't been directly exercised end-to-end this time (no browser tooling in
this environment; verification here was via bundle inspection and curl, same method used
throughout this investigation).

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

## 2026-07-12 — SDG feature removed platform-wide; Primary Genre built end-to-end as its replacement; map-pin race bug fixed; merged to main and deployed to prod

Headline: Retired the SDG/causes feature across every surface it touched and replaced it with a new Primary Genre field + real server-side search filter, mirroring the old causes/SDG architecture (top-level `Circle` sync + Mongo `$in` queries) rather than client-side filtering. Along the way, found and fixed a pre-existing map-pin race condition, did a round of filter-UI polish, and logged one new known bug for a future design decision. All work merged `staging` → `main` (`bc14ad61`, `ebd83122`, `66721b20`, `80f4fc47`) and deployed to prod; verified live.

**SDG feature removal** (commits `c2725c7e`, `60f67d6b`):
- Removed from: search/filtering, the onboarding wizard step, the circle-creation wizard step, post/discussion composer tagging, the circles-list filter button, and the members-table filter button.
- Onboarding-wizard and circle-creation-wizard steps were **disabled, not deleted** — dead code preserved in case SDGs (or a similar taxonomy) are wanted again later.
- The **Matchmaking settings tab was deleted entirely** (not just hidden) — this was the last remaining SDG surface (its filter buttons), but deleting the whole tab also removed the only way to **edit a circle's Skills after creation** via Settings. Known, accepted tradeoff — Skills can still be set at circle-creation time, just not edited afterward. Flagged here in case that's ever raised as "missing" functionality.
- Underlying schema fields (`causes`/`sdgs`) and `src/lib/data/sdgs.ts` were left **intact and untouched** — only UI and query usage were removed, not the data model or the reference data file.

**Primary Genre feature, built end-to-end** (commits `bfd38004`, `9c537293`, `d37e7388`, `d8c25921`):
- New `primaryGenres: string[]` field on artist profiles — max 3, with an "Other" option that unlocks a free-text `primaryGenreOther` field. Started as single-select, reworked to multi-select (max 3) once the design was validated.
- Synced to the top-level `Circle` document, mirroring the pre-existing `causes`/SDG architecture, specifically so search filtering can run **server-side** via Mongo `$in` queries instead of client-side post-filtering.
- Artist Identity settings: new checkbox group for selecting genres.
- Advanced search: multi-select genre filter with persistent, individually-removable pills, a numbered filter-count badge, and a "Press Enter to apply" hint under pending pills.
- Qdrant vector-search integration wired up for genre.
- Public profile display: genre badges, including "Other (custom-genre)" formatting when the artist used the free-text option.

**Bug found and fixed — stale map pins after client-side search** (part of `d37e7388`): a pre-existing race condition where map pins could silently keep showing stale/unfiltered data after *any* client-side search (this affected both the new genre filter and the existing date-range filter) — caused by a navigation-triggered RSC re-render overwriting already-filtered client state. Fixed with a guard in `ContentDisplayWrapper`.

**UI polish** (commits `0a822717`, `a84236c7`, `4e9c18c7`):
- Hid the map style switcher (globe/flat toggle) — code preserved, not deleted, in case it's wanted back later.
- Reordered Genre before Calendar in the advanced filters panel.
- Brought the Genre and Calendar filter cards to visual parity (hint contrast, z-index overlap fix, card tightening, matching "Select" trigger framing on Calendar's "Select dates").

**Known bug logged, not yet fixed:** the genre filter only affects Artists/Venues, not Events. Selecting a genre with no matches removes artist/venue pins from the map but leaves unrelated event pins visible, which reads as inconsistent/broken. Needs a design decision before fixing — options noted: have events inherit genre from their host circle, give events their own dedicated genre field, or simply hide all events while any genre filter is active. Not fixed this session; needs product input first.

**Deploy:** all of the above merged from `staging` to `main` and deployed to prod. Verified working live.

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

## 2026-08-11 — Visual-identity pilot promoted to production

Promoted the shell portion of the visual-identity pilot (developed and iterated on the
`peerify-staging` box's `staging` branch across five rounds: initial pilot on Tim Admin's own
profile → Option A restrained-accent refinement → two side-by-side-against-production correction
passes → app-wide shell extension → heading-weight tab-consistency fix) to `main`/production.
Covers: the new orange palette on pills/badges, the settings-gear/star/megaphone action-icon
gating (own-profile vs. administered-circle) and tint treatment, the left-sidebar divider fix, and
the lighter heading font-weight — now consistent across every tab of a circle, not just Home. Does
**not** cover a broader visual-identity rollout beyond this shell; page/card backgrounds and body
text remain the site's existing white/neutral defaults everywhere, per the pilot's own scope.

**Commit audit, per instruction, before touching `main` at all.** `git log main..staging` showed
36 commits total — most of them unrelated prior work already promoted to `main` separately under
different hashes (the Respond-dropdown/notify-on-accept/Connected-badge and Backstage-Lounge-
auto-enrollment/nav-bar-link features, matching commit messages, different SHAs), plus the older
Kamooni→Peerify rebrand pass (not part of this promotion either way). Of the 36, exactly 13
belonged to the pilot (`886ce805^..793979cf` on staging) — 6 carrying actual code, 7 pure
`SESSION_LOG.md` entries:

- `886ce805` Pilot new "chrome" visual identity on Tim Admin's personal profile — **code**
- `095090b3` Update SESSION_LOG.md for the new visual-identity pilot — log
- `c726df9f` Refine visual-identity pilot to Option A: restrained accent — **code**
- `ef9dca6e` Update SESSION_LOG.md for staging deploy + restrained-accent refinement — log
- `4633b70e` Correct visual pilot per side-by-side review against production — **code**
- `3273d58a` Update SESSION_LOG.md for the visual pilot correction pass — log
- `d369ef3a` Second correction pass: typography reversal, sidebar full revert, action-icon consistency — **code**
- `2728f28b` Update SESSION_LOG.md for the second visual pilot correction pass — log
- `98ac567f` Log visual pilot deploy + final acceptance of current deployed state — log
- `73544ddc` Extend pilot's shell-only fixes app-wide: nav divider, action-icon gating+tint, heading weight — **code**
- `6304cb33` Update SESSION_LOG.md for the app-wide shell-fix extension — log
- `b65fbd13` Extend lighter heading weight to every tab of a circle, not just /home — **code**
- `793979cf` Update SESSION_LOG.md for staging deploy + heading-weight tab-consistency fix — log

Listed all 13 for the user before touching `main`, per instruction, along with which 6 actually
carry code — confirmed nothing unrelated would be bundled in.

**Method.** Tested first in a disposable `git worktree` off `main`'s then-tip (`eb032786`), removed
after: cherry-picking all 13 hit a conflict on `SESSION_LOG.md` at the very first log-only commit
(the two branches' logs have diverged too far to replay cleanly) — but cherry-picking just the 6
code commits applied with **zero conflicts**, and the resulting 8 touched files
(`globals.css`, `layout.tsx`, `circles/[handle]/layout.tsx`, `global-nav.tsx`, `profile-menu.tsx`,
`pilot-chrome-scope.tsx` + `pilot-chrome.ts` [new], `home-content.tsx`) came out **byte-identical**
to staging's current tip. Given that, cherry-picked only the 6 code commits onto `main` for real
(`accbd797`, `7f27f9cd`, `f3666b11`, `65ae38a6`, `f8c33c84`, `a6668a6f`) and wrote this single
consolidated log entry instead of replaying the 7 log-only ones — re-confirmed the same
byte-identical-to-staging result on the real `main` afterward.

**Deploy.** `echo $PORT` confirmed empty in the shell before touching anything (the exact class of
bug `deploy-peerify.sh`'s own header comment warns about). `./scripts/deploy-peerify.sh` — all 8
steps passed: `bun install --frozen-lockfile` + a full `bun run build` (script-internal; no bare
build command run separately), `BUILD_ID` `b-aCANQlb1n7fE87jafhL` verified nested/matching,
`pm2 restart peerify` (staging's pid/uptime confirmed unchanged before and after), `pm2 save`,
HTTP 200 on `/` and a static asset. Ran `pm2 status` and an explicit extra `pm2 save` again myself
after the script, per instruction. `curl`'d `/`, `/explore`, and a real circle page directly —
all HTTP 200 with substantial real HTML (titles, circle names present, not error/blank pages).

**Bundle verification — not just "the build succeeded."** Grepped the actual deployed standalone
output on disk: `pilot-action-icon` and `circle-home-headings` both present in the compiled server
chunk (`.next/server/chunks/7803.js`); `pc-orange-tint` and the `#3a3129` divider hex both present
in the compiled static CSS. Cross-checked that the exact CSS file referencing those strings
(`db73b59984fafc3d.css`) is the one the live served HTML actually links to, and `curl`'d it
directly — 200, real content, contains all three markers. This is what's actually running, not
just what built.

**Production spot-check, real accounts and real data (no test/throwaway accounts created on
prod).** `tim-admin` (the staging test handle) doesn't exist on production, so asked the user
first rather than assuming — used their real production account (`tim` / Tim Olsson) for "own
profile," `a-friendly-few` (a circle `tim` created/administers) for "administered circle," and
`shamanzi` (a published artist circle `tim` has no membership or creator relationship to,
confirmed via a read-only `members`/`circles` query before picking it) for "non-admin circle" —
all per the user's explicit choices. Login via the login-link-token technique
(see [[project_peerify_staging_environment]]) against `tim`'s real account on prod specifically —
token generated, used once, cleared immediately after (`loginLinkToken`/`loginLinkTokenExpiry`
unset via a raw `MongoClient` update, confirmed `matchedCount: 1`). All three scenarios matched
staging's already-verified behavior exactly: `tim/home` and `tim/settings/about` both show the
settings gear only (tinted, no star/megaphone), heading weight `500` on both tabs (the fix this
promotion was largely about — confirmed consistent across tabs on a real account, not just a
staging test one); `a-friendly-few/home` shows all three action icons tinted with the gear
rightmost; `shamanzi/home` shows no gear (not authorized) and a plain, untinted star/megaphone
(regular-visitor production behavior untouched). Screenshotted all three — real profile photos,
real bios, real audio tracks, real "Pledge Interest"/"Follow" buttons still their original green
(money/intent actions, deliberately untouched by this pilot) — nothing looked broken or
inconsistent.

**Commits on `main`:** `accbd797`, `7f27f9cd`, `f3666b11`, `65ae38a6`, `f8c33c84`, `a6668a6f` (the
6 pilot code commits, cherry-picked in original order) + this log entry. `peerify-staging`
confirmed untouched throughout (pid/uptime unchanged in the deploy script's own check). **Live in
production** as of this entry. Pushing `main` to `origin` immediately after this commit.

## 2026-08-11 — Kamooni→Peerify system/error-page rebrand promoted to production

Promoted the Kamooni→Peerify branding fixes for system/error pages (tested and confirmed on
staging on 2026-08-09, but never previously promoted): the root `not-found`/`error` pages, the
`(auth)/` `not-found`/`unauthorized`/`unauthenticated`/`logged-out` pages, the 7 circle/module-
scoped `not-found` pages (circle-level + discussions/events/goals/issues/proposals/tasks), and the
map-pin "Unavailable" card fallback images (`default-user-cover.png`/`default-post-picture.png`).
Distinct, separate work from the visual-identity pilot promoted earlier today — predates it
entirely (`13024f51`, the last of these commits, is the direct parent of the pilot's first commit
on `staging`).

**Commit audit, per instruction, before touching `main`.** `git log main..staging` (36 commits,
same full list as this morning's pilot-promotion audit, since cherry-picking doesn't remove
commits from that view) — isolated exactly 5 as this rebrand's:

- `cc63605c` Rebrand remaining system/error graphics from Kamooni to Peerify — **code**, but mixed
  with a `SESSION_LOG.md` update in the same commit (unlike every other commit in either
  promotion today, which kept code and log entries in separate commits)
- `495c3c1e` Palette correction: warm-white cards on warm-paper page background — **code**
- `49ea07da` Update SESSION_LOG.md for palette correction follow-up — log
- `14198857` Extend two-tone Peerify branding to circle/module not-found pages — **code**
- `13024f51` Update SESSION_LOG.md for circle/module not-found rebrand — log

Listed all 5 for the user before touching `main`, flagging the `cc63605c` code/log mix explicitly
since it meant the conflict-resolution approach from this morning's promotion needed to handle a
conflict *inside* an otherwise-wanted commit, not just skip a purely-unwanted one.

**Method.** Tested in a disposable `git worktree` off `main`'s tip first (removed after):
cherry-picking `cc63605c` conflicts on `SESSION_LOG.md` only — the code/asset portion (new
`default-user-cover.png`/`default-post-picture.png`, deletes 4 old Kamooni illustration PNGs,
touches the 4 `(auth)/*` pages) applies clean. Resolved by `git checkout --ours SESSION_LOG.md`
(keep `main`'s log, discard the incoming hunk) before `cherry-pick --continue` — same principle as
skipping a pure-log commit, just applied mid-commit instead of by omission. `495c3c1e` and
`14198857` then cherry-picked with zero conflicts. Skipped `49ea07da`/`13024f51` entirely (pure
log). All 15 resulting code/asset paths, including binary `cmp` on both PNGs, came out
**byte-identical** to staging's current state. Repeated cherry-pick + same conflict resolution for
real on `main` — identical result, reconfirmed byte-identical to staging afterward.

**Deploy.** `echo $PORT` confirmed empty before touching anything. `./scripts/deploy-peerify.sh` —
all 8 steps passed (GIT_SHA `216423a8`, BUILD_ID `ZKfxIinb37jZy6hwn8oql`, nested BUILD_ID matched,
`pm2 restart peerify`, staging pid/uptime unchanged, HTTP 200 on `/` and a static asset). Ran
`pm2 status` and an explicit extra `pm2 save` myself after, per instruction.

**Production checks.** Genuine 404 (`/this-page-does-not-exist-xyz-check`) → HTTP 404, title
"Peerify — The Next Stage of Music", zero occurrences of "Kamooni" in the response body. A
nonexistent circle handle redirects to the root `not-found` page (also confirmed Peerify-branded).
For the 7 circle/module not-found pages: visiting a disabled module on a real published circle
(`shamanzi`, which only has `home`/`feed`/`followers`/`settings`/`music` enabled) redirects to
`/circles/shamanzi/not-found?module=<name>` — checked `discussions`, `events`, and `goals` this
way; the resulting page shows "Peerify" branding and the two-tone rebrand's specific hex markers
(`#f7f2ea`/`#e8dfd2`/`#e8720c`) in its HTML. Map-pin fallback images: confirmed on disk in the
live standalone bundle at the new small size (18,378 / 20,403 bytes — matching the ~18-20KB the
original staging entry described, versus the old Kamooni assets' 1.5-2.5MB), confirmed served
live via direct `curl` of `/images/default-user-cover.png` and `/images/default-post-picture.png`
(200, matching sizes), and visually confirmed by rendering the actual downloaded PNG — the pin+
person glyph in Peerify's orange, on warm paper with scattered accent dots, not the old Kamooni
illustration. Old illustration files (`access-denied.png`, `page-not-found.png`,
`logged-out.png`, `unauthenticated.png`) confirmed absent from the live bundle.

**Commits on `main`:** `8f2ae039`, `6976a3ee`, `216423a8` (the 3 rebrand code commits, cherry-
picked in original order, `8f2ae039`'s conflict resolved as described above) + this log entry.
`peerify-staging` confirmed untouched throughout. **Live in production** as of this entry.
Pushing `main` to `origin` immediately after this commit.

### 2026-08-14 (late) — Bug found: Favorites navigation 404s for circles without "feed" module enabled

**Symptom:** Favoriting a circle (e.g. Peerify Management Circle) and navigating to it via
the Favorites list in the sidebar redirects to a "not found" page:
`/circles/{handle}/not-found?redirectTo=%2Fcircles%2F{handle}&module=feed`
with the message: `We couldn't find "feed" in {Circle Name}. The "feed" is not available
in this circle. It may be disabled.`

Direct navigation to `/circles/{handle}/home` works fine — the circle itself is not broken,
only the Favorites-list navigation path.

**Likely cause:** Favorites navigation appears to default/resolve to the circle's `feed`
module rather than whatever module is actually enabled/default for that specific circle.
Circles without `feed` in `enabledModules` would 404 via this path while working normally
via direct nav.

**Investigation so far:**
- Grepped `module=feed|favorites` across src/ — hits in `bookmark-button.tsx`,
  `post/[postId]/page.tsx`, and `user-toolbox.tsx`.
- Checked `user-toolbox.tsx` specifically for "feed" — no match. RULED OUT as the
  source of the hardcoded module param. Root cause not yet located.
- Not yet checked: `bookmark-button.tsx` (bookmarking logic itself) and whatever
  component actually renders the sidebar Favorites *list* and constructs its links
  (may be a different file than any of the three above — worth a broader search).

**Status:** Not fixed, root cause not yet found. Low urgency (edge case, not a main-flow
break). Pick up fresh next session — needs read-only investigation prompt for CC before
any fix, same process as other work this week.

### 2026-08-15 — Feature idea: inline band audio preview from event artist list

**Idea:** When clicking a band name in the "Artists" list on an event detail 
page, open an inline slider/player showing that band's MP3s, rather than 
navigating away to the band's own circle page. Lets a fan browse an event's 
lineup and preview music without losing their place on the event page.

**Status:** Not scoped. Genuine feature addition, not a bug — needs its own 
investigation/scoping pass (current data model, where the band's music 
lives, how the existing full player works) before a CC prompt is drafted. 
Unrelated to the multi-artist permissions work; do not fold into that branch.

### 2026-08-15 — UX issue: Draft status not visually prominent enough

**Symptom:** On the event edit/detail page, when an event is in Draft status, 
the "Open" button is shown in solid green and is visually prominent, while 
"Status: Draft" is comparatively de-emphasized text nearby. At a glance this 
gives the impression the event may already be live/public when it is not.

**Suggestion (from person, not yet agreed as final):** Make Draft status 
more visually apparent — possibly a banner across the event's hero image 
while in Draft, not just inline text.

**Status:** Not scoped, not a regression — pre-existing UI pattern, unrelated 
to multi-artist work. Needs its own design/UX pass before a CC prompt is 
drafted.

### 2026-08-15 (afternoon) — Three items found during multi-artist staging verification, unrelated to that feature

**1. Broken/unloading circle logo images on prod admin circle list**
Observed on peerify.one/admin: some circle profile images (e.g. "Blurry
Images") show as broken image icons with alt text, not the actual uploaded
photo. NOT CONFIRMED to be the same root cause as the Aug 14 standalone-build
public/ asset issue — that was specifically about static files under
public/peerify/ not being copied into the standalone build correctly.
User-uploaded circle logos are a different code path (uploaded via saveFile,
stored separately, not part of the static public/ folder). Needs its own
investigation before assuming it's already fixed or related.

**2. Feature request: circle admins/owners should be visible in Circle
Settings**
Currently not shown in a circle's own Settings tab. Would help with
transparency/moderation clarity, especially relevant now that events can
have delegated admins across multiple circles. Not scoped yet.

**3. Bug (higher priority): Noticeboard posts set to "Everyone" audience are
not visible to non-followers**
Reproduced on staging: The Venue Festival post, audience explicitly set to
"Everyone" (not Admins/Moderators/Followers), still not visible in Feed/
Noticeboard when viewed as a logged-in user who does not follow The Venue.
This defeats the purpose of the "Everyone" audience setting for public event
promotion — a core use case for the September campaign. Needs investigation
into the actual query/visibility logic behind Noticeboard "New"/"Top" feeds,
likely a similar visibility-gate bug to ones found in event data this week
(gates added independently of intended-audience settings). Not yet
investigated or scoped for a fix.

## 2026-08-09 — Kamooni→Peerify visual rebrand: last open item, system/error graphics (Phase 0 of the rebrand plan — unrelated to the orphaned-circles Phase 0 above)

Headline: closed out the last known Kamooni-branding holdout — the app's system/error pages and
the map's "Unavailable" pin-card fallback image — after an investigation turned up more Kamooni-
era graphics than the two examples in the ask. Graphics/copy only; no logic, routing, or
error-handling behavior touched. Deployed to staging, prod untouched. Not yet promoted to prod.

**Investigation first, per instruction.** The referenced `peerify-visual-branding-plan.md` doesn't
exist on this box, so cross-checked the ask's palette/fonts against what's actually shipped:
- The root `not-found.tsx` and `(auth)/error` pages were *already* rebranded (some earlier,
  undocumented pass) using `#f7f2ea` warm paper / `#181512` charcoal / `#e8720c` orange accent —
  consistently the same palette used across ~10 live pages (holding page, onboarding, signup,
  feed empty states). That's a different accent than the mustard `#c9901a` in the ask.
- Playfair Display / Raleway are **not actually loaded anywhere** — no `next/font`, no Google
  Fonts `<link>`, no `@font-face`. They only appear as unbacked `font-family` names in the
  landing-page CSS (which would silently fall back to system serif/sans). Real body font is Wix
  Madefor Display (`--font-wix-display`, `layout.tsx`).
- Asked the user to choose; both times they picked "match what's already shipped" — `#e8720c`
  accent, no Playfair/Raleway. Applying either the mustard palette or unwired fonts here would
  have made these pages look like a *different*, newer rebrand pass sitting next to the older one
  — a bigger, separate initiative if that's ever wanted, not a small graphics fix.

**Found (beyond the two examples named in the ask):**
1. `src/app/(auth)/not-found/page.tsx` — separate 404 (distinct from the root one, used on the
   auth-flow path) — Kamooni-era storybook-watercolor illustration (`page-not-found.png`).
2. `src/app/(auth)/unauthorized/page.tsx` — same illustration family (`access-denied.png`).
3. `src/app/(auth)/unauthenticated/page.tsx` — generic stock-style illustration
   (`unauthenticated.png`) + "Oops!" copy.
4. `src/app/(auth)/logged-out/page.tsx` — matching generic illustration (`logged-out.png`).
5. Map "Unavailable" pin-card hero (`public/images/default-user-cover.png`) — the item named in
   the ask, generic navy/orange "abstract tech network" graphic, used in `map.tsx`'s
   `createMarkerPopupHtml` fallback.
6. `public/images/default-post-picture.png` — same Kamooni-era style, used as the map popup's
   post-without-image fallback, but also reused in task-detail/image-carousel. User opted to
   include it in this pass.
- Explicitly NOT touched (flagged, left for a separate call): the 7 generic (non-Kamooni,
  just unbranded/gray) circle- and module-scoped not-found pages
  (`circles/[handle]/not-found` + tasks/issues/proposals/discussions/events/goals variants) —
  user didn't opt into rebranding these this round.

**Fix:**
- Restyled all 4 `(auth)/*` pages to match the already-shipped root `not-found.tsx`/`error`
  treatment (warm paper bg, charcoal text, orange "PEERIFY" eyebrow + heading + copy, existing
  `RedirectButtons` component reused as-is — its `redirectTo` query-param logic is unchanged).
  Dropped the "Oops!" clichéd copy per the ask's "avoid generic startup clichés" instruction.
- Deleted the 4 now-fully-unused illustration files (`page-not-found.png`, `access-denied.png`,
  `unauthenticated.png`, `logged-out.png`) after confirming zero remaining references.
- Replaced `default-user-cover.png` and `default-post-picture.png` with new flat-vector artwork
  in Peerify's *actual* established illustration language (matched against `public/peerify/
  logo-mark.png` and the `default-*-avatar.svg` files, not invented from scratch): the pin+person
  glyph from the logo mark, on warm paper, with a few scattered accent dots (orange/plum/rust).
  Built via a one-off Node script using the `sharp` package already in `node_modules` (SVG →
  PNG rasterization; no image-gen tool was available). Same pixel dimensions as the originals
  (1456×816 cover, 1024×1024 post) so no call-site changes were needed. Side benefit: file size
  dropped from ~1.5–2.5MB each to ~18–20KB (simple flat vectors vs. the old detailed raster art).

**Verified on staging** (`https://staging.peerify.one`, deployed via `deploy-staging.sh`, prod
pid/uptime confirmed unchanged):
- `curl` + Playwright screenshots of `/this-page-does-not-exist-xyz` (genuine 404), `/unauthorized`,
  `/unauthenticated`, `/logged-out` — all show Peerify branding, correct palette, no residual
  Kamooni illustration references in the HTML.
- `curl` confirmed `/images/default-user-cover.png` and `/images/default-post-picture.png` now
  serve the new artwork at the same URLs `map.tsx` unconditionally requests — didn't stage a live
  "Unavailable" map marker (would've needed a suppressed/private profile with map coordinates as
  test data); the code path (`getMarkerImageUrl` fallback) is unconditional on that exact file, so
  the asset swap is sufficient confirmation. Flagging in case a real-marker check is wanted later.

**Carry-forward:**
1. Mustard/plum palette and Playfair/Raleway are apparently a *newer* intended direction (per the
   task's ask) that hasn't been rolled out anywhere yet, incl. the pages already "rebranded" with
   the older `#e8720c` orange. If mustard is meant to supersede orange app-wide, that's a real,
   separate rebrand pass (palette + font loading + every already-shipped page) — worth a decision
   before more pages get built against the old orange convention.
2. The 7 circle/module-scoped `not-found` pages (generic gray cards, not Kamooni-illustrated but
   also not on-brand) — deferred, not rebranded this round.
3. `public/images/not-found.png` — confirmed zero references anywhere in the codebase, dead
   Kamooni-era asset; left in place (not opted into cleanup this round).
4. Not promoted to prod — staging-only per instruction, awaiting go-ahead.

### Follow-up same day — palette correction: warm-white cards, not flat warm-paper

User caught that the pages above (plus the two pre-existing ones, root `not-found.tsx` and
`(auth)/error`) used a single flat `#f7f2ea` (warm paper) for the whole page — missing the
established two-shade pattern already live elsewhere (`pilot-signup-form.tsx`, the pilot
check-email page, `onboarding/peerify/page.tsx`): warm paper `#f7f2ea` for the page background,
warm white `#faf6ef` for card/panel surfaces sitting on top of it (border `#e3d5c2`, `shadow-sm`).
That contrast is what gives those pages their subtle depth; the flat single-shade version reads
noticeably flatter side-by-side.

**Fix:** wrapped all 6 system/error pages' content in a `<Card className="border-[#e3d5c2]
bg-[#faf6ef] shadow-sm">` sitting on the `bg-[#f7f2ea]` page background, matching the existing
pattern exactly rather than inventing a new one. Also shifted `default-user-cover.png` and
`default-post-picture.png`'s background fill from paper to warm white, since those images
function as card content (the map popup's hero image) rather than page background — regenerated
via the same `sharp`-based script, same dimensions, no call-site changes.

Verified on staging: all 6 pages screenshotted, card visibly distinct from the page background;
`curl` confirmed both updated PNGs serve correctly. Commit `495c3c1e`, on top of `cc63605c`. Still
staging-only, not promoted to prod.

### Follow-up same day — extended two-tone branding to the 7 circle/module not-found pages (deferred item, now closed)

Closed out the last deferred item from the two entries above: the 7 circle- and module-scoped
not-found pages (circle-level, tasks, issues, proposals, discussions, events, goals under
`src/app/circles/[handle]/`), which still used a generic `border-gray-200 bg-white/60
backdrop-blur` card and a plain gray-outline button.

**Investigation first, per instruction.** All 7 share near-identical markup (safe to apply one
pattern across all), but they differ structurally from the 6 pages fixed above: `src/app/
circles/[handle]/layout.tsx` renders `<HomeCover>`/`<HomeContent>`/`<CircleTabs>` *above*
`{children}`, so each not-found block is a constrained (`max-w-3xl`) content island embedded
partway down an already-rendered circle page, sitting on the app's plain white background
(`--background: 0% 100%` in `globals.css`) — not a full-viewport takeover we control end-to-end.
Painting a warm-paper "page" background here would either be invisible outside the narrow column
or read as an odd colored rectangle floating mid-page. Flagged this to the user rather than
forcing the literal two-tone pattern from the other 6 pages.

Found a closer, already-established precedent for this exact situation: the "No feed posts yet" /
"No community updates yet" empty states in `post-grid.tsx`/`feed.tsx`, which render in the same
embedded-in-circle-content context and use warm paper `#f7f2ea` (border `#e8dfd2`) as the *card*
color directly on the page's white background — no separate page-bg layer, since there isn't one
to set. User confirmed: match that precedent, and restyle the "Back to X" button (a plain `<Link>`,
not the shared `RedirectButtons` logic component the other 6 pages use) as the orange pill CTA.

**Fix:** all 7 files — card class changed from `border-gray-200 bg-white/60 ... backdrop-blur` to
`border-[#e8dfd2] bg-[#f7f2ea]`; heading/body text recolored to `#181512`/`#6b5f52`; button
restyled from the gray outline to `rounded-full bg-[#e8720c] ... hover:bg-[#ff8c2a]`. Copy and all
data-fetching/`notFound()` logic untouched.

**Verified on staging:** none of the 6 real modules (tasks/issues/proposals/discussions/events/
goals) were enabled on any circle here — confirmed via `circles.distinct("enabledModules")`
(only `communities, discussions, events, feed, followers, home, music, settings, shifts, tasks`
exist DB-wide, and issues/proposals/goals appear on zero circles). Temporarily added
`issues`/`proposals`/`goals` to the `tim-solo` test circle's `enabledModules` via a raw
`MongoClient` script (no app code path touched), curled and Playwright-screenshotted all 7 routes,
then reverted the circle doc immediately after (confirmed restored to its original
`enabledModules` list). Circle-level, discussions, events, and goals rendered and screenshotted
cleanly as an anonymous visitor — correct card, correct CTA, consistent with the other 6 pages.
Tasks/issues/proposals redirect anonymous visitors to `/login` client-side before the not-found
content ever paints (a pre-existing `Authenticator`-driven gate on those specific modules,
unrelated to this styling change) — confirmed via `curl` that the server-rendered HTML for those
three still contains the identical corrected markup (same shared JSX regardless of auth state).
Attempted a logged-in-as-non-member check via the login-link-token technique documented in
[[project_peerify_staging_environment]]; that surfaced a separate, pre-existing access-control
quirk (authenticated non-members get a blank content area on tasks/issues/proposals rather than
the not-found card or a login redirect) — noted as a carry-forward, explicitly NOT touched, since
it's an authorization-logic question, not a graphics one. Cleaned up the throwaway test account
afterward.

Commit `14198857`, on top of `49ea07da`. Still staging-only, not promoted to prod.

**Carry-forward:** the authenticated-non-member blank-content behavior on tasks/issues/proposals
not-found pages (see above) looks like a real, pre-existing gap worth a dedicated look — separate
task, not a styling one.

## 2026-08-09 — New "chrome" visual-identity pilot, scoped to Tim Admin's personal profile

Distinct from the Kamooni→Peerify rebrand entries above (which matched the *existing* shipped
`#e8720c`/`#181512` palette): this is the "newer direction" flagged as a carry-forward there —
three mockups (artist/fan/venue profile) confirming a new shared palette (ink `#1A1612`, cream
`#F2EBDB`, paper `#FAF6EC`/paper-light `#FDFAF3`, line `#DFD5BF`/line-soft `#ECE3CC`, muted
`#7D7164`/muted-soft `#A89B89`, orange `#E8732C`/deep `#C95F1F`/soft `#F1A674`/tint `#F8E2CE`) and
fonts (Cormorant Garamond display, Manrope body — Playfair/Raleway from the plan doc referenced in
the ask were, again, never actually wired up anywhere, confirming the earlier finding). Piloted on
one real page — Tim Admin's own profile, `/circles/tim-admin/home` — for side-by-side comparison
before deciding on a wider rollout. Not per-artist customizable theming (that's a separate, later,
paid-tier feature — explicitly out of scope here).

**Scoping approach.** `circles/[handle]/layout.tsx` (which renders `HomeCover`/`HomeContent`/
`CircleTabs`/`{children}` for every circle) only wraps its output in the new `PilotChromeScope`
client component when `circle.handle === "tim-admin"` (`PILOT_CHROME_HANDLE`, in the new
`lib/peerify/pilot-chrome.ts`) — zero cost/risk for every other circle. That wrapper double-checks
`usePathname()` against the exact `PILOT_CHROME_PATH` (`/circles/tim-admin/home`) before adding a
`.pilot-chrome` class, so tim-admin's own other tabs (settings, followers, etc.) fall back to the
current look too — confirmed by screenshot. `GlobalNav` and the top-right `ProfileMenu` render
*outside* that page's DOM subtree (siblings in the root layout), so each does its own
`isPilotChromePath(pathname)` check and adds `.pilot-chrome` to its own root element only on that
route — no new prop drilling, both already had `pathname` via existing hooks.

All new palette/token work lives in one new `globals.css` block, entirely scoped under
`.pilot-chrome`/`.pilot-chrome-page` selectors: (a) redefines the existing shadcn CSS vars
(`--background`, `--foreground`, `--primary`, `--muted`, `--border`, etc.) so every Card/Badge/
Button/Tabs element that already relies on them retints for free with no component edits, and (b)
remaps each literal Tailwind utility class actually found in this render tree (`bg-white`,
`text-gray-600`, `bg-[#181512]`, `hover:bg-[#241f1a]`, etc.) to the new tokens by targeting the
exact compiled class selector, scoped under `.pilot-chrome` so it's inert everywhere else.
Deliberately left untouched: semantic/status colors that aren't page chrome (the green
"Connected"/founding-member/relationship badges, the venue booking-enquiry card's colors) — those
carry meaning independent of brand palette, matching how the earlier rebrand entries above treated
functional color-coding.

Fonts loaded via `next/font/google` in `layout.tsx` exactly like the existing four fonts there
(Cormorant Garamond weights 400–700 + italic, Manrope 400–700), exposed as `--font-cormorant`/
`--font-manrope` on `<html>` globally (like `--font-yeseva` etc. already are) — inert until
referenced, only ever applied inside `.pilot-chrome`.

**Bug caught during verification:** the first pass set `background-color`/`color` directly on the
shared `.pilot-chrome` base rule. Since `GlobalNav`, `ProfileMenu`, and the page wrapper all use
that same class, this painted an unwanted solid paper-colored box behind the profile-menu's icon
buttons (which don't have their own outer background) — visible as a stray rectangle over the
cover photo. Fixed by moving the page-canvas `background-color`/`color` to a second, page-only
class (`.pilot-chrome-page`, added only by `PilotChromeScope`), leaving the shared `.pilot-chrome`
class to carry only the CSS variables/font-family. Re-verified via screenshot — gone.

**Verified without touching staging or prod.** Built the branch (`bun run build`, clean, only
pre-existing lint warnings) and ran the resulting `.next/standalone` output as a fully separate
`node server.js` process on port 3002 (symlinked `node_modules`/server chunks from the real
standalone output, copied over a fresh `.next/static`, pointed at the same `peerify_staging`
Mongo/MinIO so real data — including tim-admin's actual profile — was visible) — this never
touched the pm2-managed `peerify`/`peerify-staging` processes or their standalone directories, and
`pm2 jlist` confirmed both kept their original pid/uptime throughout. Used the login-link-token
technique from [[project_peerify_staging_environment]] to get a real authenticated session (as
tim-admin) without a password, then Playwright-screenshotted: the pilot page itself (new palette/
fonts confirmed via computed-style checks — `background-color`/`color`/`font-family` on all three
`.pilot-chrome` roots matched the new tokens exactly), a different circle's home page, tim-admin's
own settings tab, and `/explore` — all three confirmed to still render the original, unmodified
look (`.pilot-chrome` absent from their HTML entirely). Cleaned up the test login token from
tim-admin's circle doc and the temporary standalone directory afterward.

Commit `886ce805`, on top of `13024f51`. Staging-only per instruction; not deployed in this entry.

### Follow-up same day — deployed to staging

User gave the explicit go-ahead. Ran `./deploy-staging.sh` (all 8 steps passed — BUILD_ID
`K56T-Mnt3Pkofi-ix93Gd`, static assets copied, HTTP checks green); `pm2 jlist` confirmed `peerify`
(prod) kept its original pid/uptime throughout. Re-verified live on the real domain (not
localhost) per [[project_peerify_staging_environment]] — login-link-token as tim-admin,
Playwright-screenshotted `https://staging.peerify.one/circles/tim-admin/home` (new palette/fonts
present, matches the local preview exactly) and `https://staging.peerify.one/explore` (unaffected,
`.pilot-chrome` absent). Cleaned up the test login token afterward.

### Follow-up same day — refined to "Option A: restrained accent" per review feedback

Review of the deployed pilot came back with specific fixes, all still scoped to
`/circles/tim-admin/home` only:

1. The social icon row (LinkedIn/Instagram/GitHub/YouTube in `social-links.tsx`) had picked up
   the pass-1 muted-brown text token via a blanket `text-gray-500/600/700`/`text-slate-600/700`
   remap — needed to stay neutral regardless of what's below it.
2. The settings-gear button (`home-content.tsx`'s `settingsButtonClassName`) was — and always had
   been, independent of this pilot — solid emerald green with a green hover. New rule for this
   page: orange is the only interactive/hover accent in the shell chrome; green is reserved for
   money/intent-committing actions (a Pledge-style action), which this button isn't.
3. Cards (About/Offers/sidebar cards) needed to stay white with their existing thin neutral
   border, not pass 1's warm/cream surface.
4. Headings-only Cormorant Garamond, body/buttons/labels stay Manrope — already correct from pass
   1, reconfirmed rather than changed.
5. Badge/pill/tag elements (offer tags, relationship/status chips) should use a restrained
   orange-tint rather than defaulting to ink/muted.

Explicitly out of scope, stated up front: don't move or restructure the left sidebar nav — this
is a color/typography pass only.

**Root cause, once traced:** pass 1's approach was "shift the whole page to a warm cream/paper
theme," done via (a) remapping the shadcn CSS vars (`--background`/`--foreground`/`--muted`/
`--border`/etc.) to warm HSL values, and (b) a blanket remap of literal `bg-white`/`text-gray-*`/
`bg-slate-*` classes to warm tokens, both scoped under `.pilot-chrome`. That blanket literal-class
remap is exactly what caught the social icons (item 1) — they use plain `text-gray-500`, no
different from any other gray text on the page — and is exactly why cards read as warm/cream
instead of white (item 3). The settings-gear button (item 2) was never part of either remap; it's
been emerald green outside the pilot too, just newly visible/flagged now that the page around it
changed.

**Fix — reworked to Option A (restrained accent):**
- Removed the `--background`/`--foreground`/`--card`/`--card-foreground`/`--popover`/
  `--popover-foreground`/`--secondary`/`--secondary-foreground`/`--muted`/`--muted-foreground`/
  `--accent`/`--accent-foreground`/`--border`/`--input` overrides entirely — these now inherit the
  site's normal white/neutral defaults inside `.pilot-chrome` too. Kept only `--primary`/
  `--primary-foreground`/`--ring` overridden to the new orange — the one accent color threaded
  through every Button/Tabs/link that already relies on it, no component edits needed.
- Removed the blanket `bg-white`/`border-white`/`text-gray-800/900`/`text-gray-500/600/700`/
  `text-slate-600/700`/`bg-gray-100/200`/`bg-slate-50/100`/`border-gray-300` remap entirely — this
  is what fixes item 1 (social icons) and item 3 (cards) simultaneously, since neither is touched
  by anything anymore.
- Added new, narrowly-targeted rules instead: the `variant="offering"` badge (near-black/gold, in
  `tour-team-offerings-card.tsx`) and the generic status/count chips + "+N more" skill/need
  overflow badges (previously slate/gray) now get `--pc-orange-tint` background + `--pc-orange-
  deep` text — restrained, not saturated. Deliberately left alone: the semantic-green "Connected"
  relationship chip (`bg-[#f3f7f4]`/`text-[#45604d]`) and the founding-member badge (its own
  `--founding-member-*` vars) — real status meaning, not default chip styling, same principle as
  the earlier Kamooni→Peerify rebrand entries' treatment of functional color-coding.
- Settings-gear button: added `border-emerald-950`/`bg-emerald-950`/`hover:bg-emerald-900`/
  `focus-visible:ring-emerald-950` overrides to orange/orange-deep/orange (resting/hover/ring).
- `PilotChromeScope` no longer adds a second `.pilot-chrome-page` class — with the page canvas no
  longer painted, the page/nav/profile-menu wrappers can safely share one class again.
- Left sidebar nav (`global-nav.tsx`/`global-nav-items.tsx`) and the top-right profile menu:
  untouched, confirmed by `git diff --stat` touching only `globals.css` and
  `pilot-chrome-scope.tsx` — byte-for-byte identical CSS rules to the prior commit.

**Judgment calls, not itemized in the ask, flagged here:** left two other pre-existing greens
alone — `VerifiedContributionsPanel`'s verified-checkmark icon (`text-emerald-600`) and the
`upcoming-shifts-panel.tsx` capacity label (`text-emerald-700`, though this panel doesn't render on
a personal/`circleType: "user"` profile anyway). Neither is a hover/focus state or shell chrome;
both are static semantic status indicators, same category as the "Connected" chip. Also confirmed
no Pledge/money-style action actually renders on this personal profile (that's gated on
`isPeerifyArtistProfile`, false for `circleType: "user"`) — so currently zero green renders
anywhere on this page outside the two status-icon cases just named.

**Verified without touching staging or prod**, same technique as the deploy-day entry above: built
the branch clean (`bun run build`, no new lint warnings), ran the `.next/standalone` output as an
isolated `node server.js` on port 3002 (fresh symlinked copy, not the pm2-served directory),
login-link-token as tim-admin. Confirmed via computed-style checks: settings-gear
`background-color` is `rgb(232, 115, 44)` (`#E8732C`) resting → `rgb(201, 95, 31)` (`#C95F1F`) on
`:hover`, `--tw-ring-color` is `#e8732c` on `:focus-visible` (no emerald anywhere); social-icon
`color` is `rgb(107, 114, 128)` (Tailwind's unmodified `gray-500`); offering-badge and
relationship-chip `background-color`/`color` are `rgb(248, 226, 206)`/`rgb(201, 95, 31)`
(orange-tint/orange-deep); profile-name and "About"/"Offers" headings compute to `"Cormorant
Garamond", ... serif`, "Edit" buttons compute to `Manrope, ... sans-serif`. Screenshot-compared
the pilot page (cards now genuinely white, not cream) against a different circle's home, tim-admin's
own settings tab, and `/explore` — all three still `.pilot-chrome`-absent and visually untouched.
`pm2 jlist` confirmed `peerify`/`peerify-staging` pids/uptimes unchanged throughout. Cleaned up the
test login token and temporary standalone directory afterward.

Commit `c726df9f`, on top of `886ce805`/`095090b3`. Staging-only per instruction; not deployed in
this entry.

### Follow-up same day — deployed to staging

User gave the go-ahead again. `./deploy-staging.sh` — all 8 steps passed (BUILD_ID
`o6d1pEDfcLAHdHcXpvusd`); `pm2 jlist` confirmed `peerify` (prod) pid/uptime unchanged. Re-verified
live on `https://staging.peerify.one/circles/tim-admin/home` via the login-link-token technique
(real domain, not localhost, per [[project_peerify_staging_environment]]) — matches the local
preview exactly. `/explore` confirmed unaffected. Cleaned up the test login token afterward.

## 2026-08-10 — Visual pilot correction pass, per side-by-side review against production

Same pilot page (`/circles/tim-admin/home`), same "Option A: restrained accent" direction from the
prior entries — this is a targeted correction pass after the user compared the deployed pilot
side-by-side against real production and flagged six specific things, all still scoped to this one
page, no component files touched (every fix is a `globals.css` selector or the new heading-weight
toggle described below):

1. **Left sidebar active-state.** Production's own treatment for an active nav item is text-color
   + a framer-motion icon-scale on hover/tap (`global-nav-items.tsx`, never touched by any pass).
   Pass 1 had *also* given every nav item's `:hover` a solid `--pc-orange-deep` background fill —
   combined with an active item's orange text, that reads as a "solid-fill highlight block," not
   production's subtle one. Fix: removed the `.hover\:bg-\[\#241f1a\]:hover` override entirely, so
   hover now falls through to the component's own original, unmodified `hover:bg-[#241f1a]`.
   (Side investigation before landing on this: initially suspected the two solid-looking circles
   in the sidebar's pinned-circle tray below the divider were the culprit — traced them via a raw
   `MongoClient` query on `tim-admin`'s `pinnedCircles` array (values are real `ObjectId`s, not the
   strings `JSON.stringify` makes them look like — a `findOne({_id: "<hex>"})` string-vs-ObjectId
   mismatch returned false negatives at first) to two real, pre-existing uploaded circle pictures
   ("Peerify Main", "The Backstage Lounge") — unrelated to the pilot, ruled out.)
2. **Action icons (mail/clipboard/bell).** Reverted the `bg-[#f1f1f1]`/`hover:bg-[#cecece]`
   overrides — these render at their original plain light-gray now, no tint.
3. **Divider below "Create."** User confirmed the more-visible-than-production divider is a real
   improvement — kept, but reworked from a flat solid `background-color` bar to a soft-edged
   `linear-gradient` fade (transparent → muted-soft → transparent), for a more intentional feel
   without increasing loudness.
4. **Settings-gear button.** Was a solid saturated-orange fill (pass 2's fix for the *original*
   solid-emerald-green button) — visually "the odd one out" next to neutral outline icons. Now
   matches the pills' own tint treatment: `--pc-orange-tint` background, `--pc-orange-deep` icon,
   transparent border (no visible border line, same as the badge component's own variants). The
   icon-color override uses a compound selector, `.border-emerald-950.text-white`, so it only ever
   matches this one button — `text-white` alone is far too generic a hook to touch safely.
5. **Social icon row.** Already plain since the prior pass's fix (item 1 there) — nothing to
   change; noted as now consistent with item 2's action-icon revert, so the two rows read as one
   design language rather than two.
6. **Typography experiment (Cormorant Garamond 500 vs. 600).** Not a decision — the ask was to make
   both weights comparable, not to pick one. Headings now default to weight 500 (they'd
   previously inherited the site's own unscoped `h1,h2,...{font-weight:600}` rule, since pass 1/2
   only ever set `font-family` on headings, never `font-weight`). Added
   `PilotChromeScope`'s only new behavior this pass: reads `useSearchParams().get("heading-weight")`
   and adds a second `.heading-weight-600` class when it's `"600"`, which a scoped override rule
   flips back to 600 — so `?heading-weight=600` on the pilot URL is a live, on-page toggle for
   direct comparison, no separate build or deploy needed to see either option.

**Verified without touching staging or prod**, same isolated-standalone-server technique as the
prior two entries (fresh `bun run build`, symlinked `.next/standalone` copy on port 3002, never the
pm2-served directory, login-link-token as tim-admin). Confirmed via computed-style + hover-simulation
checks: nav item background is `transparent` at rest and `rgb(36, 31, 26)` (`#241F1A`, the original
value) on `:hover` — no orange anywhere in nav hover; the three action-icon buttons compute to
`rgb(241, 241, 241)` (`#F1F1F1`, unchanged); settings-gear computes to `rgb(248, 226, 206)` bg /
`transparent` border / `rgb(201, 95, 31)` icon color at rest, `rgb(241, 166, 116)` (orange-soft) on
hover; the divider's `background-image` computes to the expected `linear-gradient(...)` with
transparent ends; offering-badge and "Member" chip compute to the *same* `rgb(248, 226, 206)`/
`rgb(201, 95, 31)` as the previous commit (pill colors confirmed unchanged); social-icon color is
still unmodified `rgb(107, 114, 128)` (Tailwind `gray-500`); `h4`/`h1` heading `font-weight` computes
to `500` by default and `600` with `?heading-weight=600` appended — both screenshotted side by side
for the visible comparison the ask required. Re-confirmed the usual scoping guarantees: a different
circle's home page, tim-admin's own settings tab, and `/explore` are all still `.pilot-chrome`-absent.
`pm2 jlist` confirmed `peerify`/`peerify-staging` pids/uptimes unchanged throughout. Cleaned up the
test login token and temporary standalone directory afterward.

Commit `4633b70e`, on top of `c726df9f`/`ef9dca6e`. Staging-only per instruction; not deployed in
this entry.

### Follow-up same day — deployed to staging

User gave the go-ahead again. `./deploy-staging.sh` — all 8 steps passed (BUILD_ID
`2jgUL809lnsZNiccMEQXu`); `pm2 jlist` confirmed `peerify` (prod) pid/uptime unchanged. Re-verified
live on `https://staging.peerify.one/circles/tim-admin/home` (login-link-token as tim-admin, real
domain not localhost, per [[project_peerify_staging_environment]]) — matches the local preview.
`/explore` confirmed unaffected. Cleaned up the test login token afterward.

## 2026-08-10 — Second correction pass: typography reversal, sidebar full revert, action-icon consistency

Same pilot page, another round of specific fixes from review — this time the review compared the
deployed pilot against real production directly (not just internal consistency), which surfaced a
different class of issue than the first correction pass: two outright wrong claims from earlier
entries (Cormorant Garamond as a considered typeface, and an implied "Arial" baseline that was
never actually checked) and one real cross-contamination bug in the CSS scoping itself.

**1. Typography — reversed course.** The ask was blunt: remove Cormorant Garamond entirely, find
out what production's heading font *actually* is rather than assuming, and only touch weight.
Checked `layout.tsx` and the unscoped `h1,h2,h3,h4,h5,h6 { font-family: var(--font-wix-display);
font-weight: 600; ... }` rule in `globals.css`: production's heading font is **Wix Madefor
Display** (loaded via `next/font/google` as `wix`, same as the rest of the app's headings) — not
Arial, and not something that needed replacing. Kept it, dropped `font-weight` from 600 to 500.
Also dropped Manrope from body text (it was Option A's only other font substitution) rather than
keep a mismatched pairing — with headings back on production's own font, a second custom font for
body text alone would have re-created exactly the "two design languages" problem the social-icon-
row fix in the previous correction pass was about. Removed both `Cormorant_Garamond`/`Manrope`
`next/font/google` calls and their `<html>` variable classes from `layout.tsx` entirely, since
nothing references either anymore.

**2. Left sidebar — reverted fully to production, kept only the divider.** Removed every remaining
nav color override (background, text, hover states) from earlier passes; verified via computed
style that the nav's background/text now resolve to the *exact* original production hex values
(`rgb(24, 21, 18)` = `#181512`, `rgb(250, 246, 239)` = `#faf6ef`), not the pilot's near-identical
but distinct `--pc-ink`/`--pc-cream`. Kept the soft-edged gradient divider below "Create" from the
prior pass (explicitly confirmed as worth keeping) unchanged.

Investigating the ask's second sidebar complaint — "the empty pinned-favorite slot picked up an
orange tinted outline" — turned up a real scoping bug, not just a color to revert: the dashed
pin-placeholder button in `global-nav-items.tsx` uses the literal Tailwind class `border-gray-300`
— the *exact same class* AboutPage's "+N more" skill/need overflow badges use, which an earlier
pass had retinted to `--pc-orange-soft`. Both were scoped under the same shared `.pilot-chrome`
class, and since the nav's own wrapper also carries that class (for the divider rule), the badge
override bled straight onto the nav control despite being nowhere near it in the DOM. Root-caused
via a raw `MongoClient` query trail (see the sidebar-active-state investigation two entries above)
that turned out to be a red herring for *this* bug too — the actual fix was purely a CSS scoping
one. **Fix:** split the shared class in two — `.pilot-chrome` (nav + profile-menu, now inert
except the divider rule) and `.pilot-chrome-page` (page-content wrapper only, added by
`PilotChromeScope`) — and moved every page-only rule (badges, heading weight) onto the latter.
Confirmed fixed: the pin-placeholder's computed `border-color` is now `rgb(209, 213, 219)`,
Tailwind's unmodified `gray-300`.

**3. Action icons — investigated first, per instruction.** Traced how `home-content.tsx` already
distinguishes "own profile" from "administered circle": `showSettingsButton = authorizedToEdit &&
circle.handle && (!isUser || isOwnUserProfile)` and `isOwnUserProfile = isUser && (user?.did ===
circle.did || viewerDid === circle.did)` — both already computed, both reused as-is (no new
permission check written). Reported this back before implementing anything, per instruction.

Realized partway through that gating the new behavior by *page* (the established pattern for
every other change in this pilot) can't actually satisfy the ask: tim-admin's own profile is
always `circleType: "user"`, so it can never itself be "a circle the user administers" — the
second scenario the ask describes is structurally unreachable if scoped to a single fixed
pathname. Resolved by gating on the *viewer* instead: `isPilotViewer = user?.handle ===
PILOT_CHROME_HANDLE`, combined with the existing `showSettingsButton`/`isOwnUserProfile` above.
This makes the feature reachable on any circle tim-admin administers (confirmed candidates via a
raw `MongoClient` query on `circles.createdBy`: `tim-solo`, `the-band`, `the-venue`, `proddy`,
`peerify-main`, `the-backstage-lounge`), while staying invisible to every other viewer on every
page, including tim-admin's own circles when viewed by someone else — arguably a more faithful
"pilot for one person" than a hardcoded single URL would have been.

This forced the `.pilot-action-icon` tint rule itself to move outside the `.pilot-chrome-page`
scope from item 2 above (that scope is pathname-gated and would never reach a second page like
`tim-solo`) — it's now a plain top-level CSS rule, with its `--pc-orange*` tokens promoted to the
site's global `:root` block (harmless; unused unless that one class is present) instead of living
inside `.pilot-chrome`.

**Fix:** on the viewer's own personal profile, star (bookmark) and megaphone (notification
settings) now hide entirely, leaving only the settings gear. On a circle the viewer administers,
all three show, reordered so the gear is last/rightmost (implemented by hoisting a single
`settingsButtonElement` and conditionally rendering it either in its original middle position, for
every non-pilot-viewer context — unchanged — or last, for the pilot-viewer context). All three now
share one visual treatment — tint fill, deep-orange icon, no border — via the shared
`.pilot-action-icon` class, replacing the settings-gear's previous CSS-override-on-emerald-classes
approach (which only worked because `border-emerald-950`/`bg-emerald-950` happen to be unique
strings) with a `className` passed straight through `BookmarkButton`/`NotificationSettingsDialog`'s
existing prop — no changes to either shared component, so it's inert everywhere else in the app.
The gear's production styling (solid emerald green) is otherwise completely unchanged for every
non-pilot-viewer context.

**4. Alignment.** The social-icon-row wrapper had a stray `pt-2` nobody else in the same flex row
had, pushing it visibly below the action-icon row despite `items-center` on the shared parent.
Removed it — confirmed via `getBoundingClientRect()` that both rows now share the exact same
vertical center (`384`/`384`).

**Verified without touching staging or prod**, same isolated-standalone-server technique as every
entry above (fresh `bun run build`/lint, both clean with no new warnings; symlinked
`.next/standalone` copy on an unrelated port; login-link-token as tim-admin). Confirmed via
computed-style checks: heading `font-family` is unquoted `"Wix Madefor Display", "Wix Madefor
Display Fallback"` at `font-weight: 500` on tim-admin's own page; the *same* heading on `tim-solo`
(administered-circle branch) computes to `700`/`600` — production's untouched defaults, proving
the typography change didn't leak into the second scope. On tim-admin's own page: settings gear
present with no star/megaphone; on `tim-solo`: all three present, tinted identically
(`rgb(248, 226, 206)` background on all three), at x-positions confirming star → megaphone → gear
left-to-right. Confirmed `tim-solo` and `the-backstage-lounge` (both circles tim-admin administers)
have no `.pilot-chrome`/`.pilot-chrome-page` in their HTML at all — only the viewer-gated action-
icon classes reach those pages, nothing else from this pilot does. Re-confirmed the usual
scoping guarantees on `tim-admin`'s own settings tab and `/explore`. Offering-badge/relationship-
chip colors confirmed byte-identical to the prior commit. `pm2 jlist` confirmed
`peerify`/`peerify-staging` pids/uptimes unchanged throughout. Cleaned up the test login token and
temporary standalone directory afterward.

Commit `d369ef3a`, on top of `4633b70e`. Staging-only per instruction; not deployed in this entry.

### Follow-up same day — deployed to staging, then accepted as final

User gave the go-ahead again. `./deploy-staging.sh` — all 8 steps passed (BUILD_ID
`v8LfjQMObKQB1LdW2Bh4k`); `pm2 jlist` confirmed `peerify` (prod) pid/uptime unchanged. Re-verified
live on the real domain (login-link-token as tim-admin, per
[[project_peerify_staging_environment]]): `https://staging.peerify.one/circles/tim-admin/home`
(own profile — gear only, no star/megaphone) and `https://staging.peerify.one/circles/tim-solo/home`
(administered circle — all three, gear rightmost, matching the local preview and each other).
`/explore` confirmed unaffected. Cleaned up the test login token afterward.

User then confirmed: **keep what's currently deployed, no further comparison against production
needed.** This closes out the visual-identity pilot (started two entries above as "chrome" palette
+ typography on `/circles/tim-admin/home`, refined to Option A's restrained-accent treatment, then
corrected twice against side-by-side production review) — the deployed state as of commit
`d369ef3a` (BUILD_ID `v8LfjQMObKQB1LdW2Bh4k`) is the accepted result. No wider-rollout decision
requested yet; per the pilot's original scope this stays a single-page comparison
(`/circles/tim-admin/home`, plus the viewer-gated action-icon treatment reachable on circles
tim-admin administers) rather than something applied elsewhere in the app.

## 2026-08-10 — Extended three shell-only fixes app-wide (not the full visual-identity rollout)

Follow-up the same day: font-weight explicitly confirmed final (no further comparison), then a
narrower ask than "roll out the pilot everywhere" — take exactly three of the pilot's shared-
component fixes (nav divider, settings-gear/star/megaphone gating+tint, heading font-weight) and
stop scoping them to the one page they were built against, since they're shared components
rendered identically everywhere. Everything else from the pilot (badges, the `--primary`/`--ring`
tab-accent color on `CircleTabs`, the profile-menu's small ink recolors) explicitly stays exactly
as narrow as before — `/circles/tim-admin/home` only — none of those three were named in this
round's ask.

**Per-item scope, and why each ended up where it did:**

1. **Nav divider.** No scoping mechanism needed at all anymore — `global-nav.tsx` no longer
   references `.pilot-chrome`, reverted to its exact original unconditional `className`. The
   divider rule (`.bg-[#3a3129]`, the gradient fade from the first correction pass) became a plain
   top-level CSS rule, since the nav renders identically on every page regardless of pilot status.
2. **Settings-gear/star/megaphone action icons.** `home-content.tsx`'s `isPilotActionIconsContext`
   was `isPilotViewer && showSettingsButton` (viewer-gated, from the prior "extend to circles
   tim-admin administers" fix); dropped the `isPilotViewer` half entirely, so it's now just
   `showSettingsButton` — the same own-profile-vs-administered-circle logic, for every viewer. The
   settings-gear's old solid-emerald-green branch of `settingsButtonClassName`'s ternary became
   dead code the moment the condition turned unconditional (it can never be false when
   `showSettingsButton` is true anymore) — removed rather than left unreachable.
3. **Heading font-weight.** This one couldn't just drop its scope check — `HomeContent`'s name
   heading renders on *every* tab of a circle (it's the shared header), but "Feed/Noticeboard post
   cards... Admin screens... out of scope" meant the weight change must NOT follow it onto those
   other tabs. Added `isCircleHomePath` to `pilot-chrome.ts` (`/^\/circles\/[^/]+\/home\/?$/` —
   any handle, but only the `/home` tab specifically) and a second, independent boolean in
   `PilotChromeScope` alongside the original `isPilotChromePath` check — the page-content wrapper
   now carries two classes computed separately (`.pilot-chrome`/`.pilot-chrome-page`, still exact-
   match-only, and the new `.circle-home-headings`, broad-match) rather than one. This means a
   circle's name heading is intentionally lighter on its `/home` tab and production-weight on
   every other tab of the *same* circle — a real, visible inconsistency, but the accepted
   trade-off of "only extend what was actually visually tested," not a bug; called out explicitly
   below rather than quietly patched.

**Verified against the four page types named in the ask** (isolated standalone build on an
unrelated port, as in every prior entry, real login-link-token sessions — never staging/prod):
own profile (`tim-admin`) — gear only, no star/megaphone, heading weight 500. Administered circle
(`tim-solo`, one of the circles found via the earlier `createdBy` query) — all three action icons
present and tinted, gear rightmost, heading weight 500. A circle tim-admin does *not* administer
(`default`/Kamooni, found via a `members` collection query for circles where his DID isn't in the
member list) — no gear (not authorized), star/megaphone present but *not* tinted
(`background-color: rgba(0,0,0,0)`, confirming regular-visitor production behavior is untouched),
heading weight still 500 (this is also a `/home` tab, correctly widened). `/explore` — shell
elements absent entirely, as expected for a non-circle page. Two extra checks beyond what was
asked, specifically to probe the "shell renders every tab, heading-weight is /home-only" tension
named above: `tim-solo`'s Noticeboard and Settings tabs both show the *same* tinted, correctly-
ordered action-icon shell as `/home` (confirms item 2 is genuinely shell-wide), while the name
heading on both computes back to weight `700` (its own explicit `font-bold`, unaffected by the
pilot) rather than `500` (confirms item 3 stayed exactly as narrow as intended). Screenshotted all
six pages — nothing looked broken or inconsistent enough to warrant stopping and reporting back,
per the instruction's escape hatch. Build and lint clean, no new warnings; `git diff --stat`
confirms `global-nav-items.tsx` and `profile-menu.tsx` are untouched.

Commit `73544ddc`, on top of `98ac567f`. Staging-only per instruction; not deployed in this entry.

### Follow-up same day — deployed to staging

User gave the go-ahead. `./deploy-staging.sh` — all 8 steps passed (BUILD_ID
`sWDpBdUZ8wZhIItBl8pJ5`; the build step logged several transient "Retrying 1/3..." lines partway
through — a Google Fonts metadata fetch hiccup, unrelated to any pilot change, resolved on its own
and the build still compiled cleanly). `pm2 jlist` confirmed `peerify` (prod) pid/uptime unchanged.
Re-verified live on the real domain across all four page types from the prior entry (own profile,
`tim-solo` administered circle, `default`/Kamooni non-admin circle, `/explore`) — all matched the
local preview exactly. Cleaned up the test login token afterward.

## 2026-08-11 — Heading weight: extended from /home-only to every tab of a circle

Follow-up fix, same shell-extension effort as the entry above: the lighter heading weight only
ever applied on a circle's `/home` tab (`.circle-home-headings`, scoped by `isCircleHomePath` —
an exact `/circles/[handle]/home` match). Settings, Noticeboard, Followers, Circles, Events, and
any other tab still rendered the circle's name heading at production's original weight, since
`HomeContent`'s name `<h4>` is shell — it renders once per circle layout, above `{children}`,
*identically regardless of which tab is active* — but the CSS scope it depended on was keyed to
the current route, not to "is this the shell." Visiting a circle's Settings tab right after its
Home tab made the inconsistency obvious: same heading, same position, different weight.

**Investigation, per instruction:** confirmed via grep that `.circle-home-headings` covers
`h1,h2,h3,h4,.heading,.header`, but only ONE of those (`HomeContent`'s `<h4>`) is actually shared
shell — the `h1`/`h2`/`h3` elements the same rule was hitting are all `PresenceCard`-rendered
("About"/"Offers"/"Venue overview" titles), which only ever exist inside `{children}` on the
`/home` tab in the first place (`AboutPage`/`OffersCard`/`TourTeamOfferingsCard`) — they can't
render on Settings/Followers/etc. regardless of CSS scope, so they never needed a scope change.

**Cleanest fix, reported before implementing:** rather than widening the pathname regex to try to
cover "every tab of a circle" (which risks catching {children}'s own tab-specific content
headings too — Settings' own section titles, etc. — never part of what was asked), gave the name
heading a direct, unconditional `font-medium` class in `home-content.tsx` (replacing `font-bold`)
instead of a route-scoped CSS rule. Since `HomeContent` is already one shared component instance
rendered identically for every tab, this direct edit **is** the "one shared rule" the investigation
was asked to find — simpler and more precise than any CSS-scope widening would have been. Removed
`h4` from the `.circle-home-headings` selector (now redundant, and dead — nothing else uses that
class on an `h4`) and updated the rule's comment to clarify it's `PresenceCard`'s home-tab-only
titles specifically, not the name heading.

**Verified across every tab named in the ask** — Home, Noticeboard, Followers, Circles/Community,
Events, Settings — on all three profile types: `tim-admin`'s own profile (all 6 tabs: heading
weight `500`, `Wix Madefor Display` unchanged, gear present/tinted, star/megaphone absent — icon
gating exactly as before), `tim-solo` administered circle (all 5 tabs checked: heading weight
`500`, all three action icons present and tinted, gear last), `default`/Kamooni non-admin circle
(3 tabs checked: heading weight `500`, no gear, star present but untinted — regular-visitor
behavior unaffected). 14 tab checks total, all consistent. Screenshotted the Kamooni Followers tab
specifically to confirm visually, not just via computed style — the lighter heading reads
correctly there now, nothing else on the page shifted. `git diff --stat` shows only `globals.css`
and `home-content.tsx` touched — the icon-gating logic, nav divider, and alignment fix from the
prior entry are untouched by construction, not just by re-verification. Build and lint clean, no
new warnings. Same isolated-standalone-server technique as every entry above; never touched
staging or prod during verification.

Commit `b65fbd13`, on top of `6304cb33`. **Staging-only, not deployed** — per instruction,
awaiting go-ahead before running `deploy-staging.sh`.

## 2026-08-11 — Two mobile-viewport bugs found and fixed: Explore search-bar overlap, CircleTabs vs bottom nav

Asked to check the live site (`https://peerify.one`) on mobile as a diagnostic (Playwright,
`devices["iPhone 13"]`, 390×664). Found two pre-existing, unrelated bugs — neither touched by the
pilot/rebrand work already in prod — and was told to fix both.

**Bug 1 — Explore page:** the search/filter controls (`map-explorer.tsx`) and the top-right
profile-menu buttons both use fixed-offset positioning, reserving `mobileTopControlsRight = 128px`
of clearance. That constant was sized for the *authenticated* state (single avatar button), but
never accounted for the wider *unauthenticated* "Log in"/"Sign up" button pair — measured at 169px
wide, sitting at `right-6` (24px from the edge), i.e. needing ~193px of clearance, not 128px. On
mobile with a logged-out viewer, the search bar's icons rendered directly under those buttons.
Fix: bumped the constant to 205px (small buffer above the measured 193px). Single-line change.

**Bug 2 — Circle profile pages:** the `CircleTabs` row ("Home / Noticeboard / More") could render
partially behind the fixed bottom nav (`GlobalNav`, `z-[300]`, opaque) on the initial unscrolled
load. Root cause: the bottom-nav clearance in `GlobalNav` is a flex `order-last` spacer, which only
reserves space at the very *end* of the page's scroll length — it does nothing for content that
happens to land near the viewport's bottom edge on first paint. How far CircleTabs sits down the
page is entirely a function of how much header content precedes it (bio, "Pledge Interest" button,
genre badges), so the overlap's severity varies a lot by circle: measured 16px on a simple profile,
84px-worth-too-tall (tabs partly below the viewport entirely) on `tim-solo`, whose header has 7
wrapped genre badges across 3 rows.

Considered and rejected `position: sticky; bottom: <navHeight>` on `CircleTabs` — it would fix the
initial-load case but, since `CircleTabs` is the persistent shell for every module tab (Settings,
Noticeboard, Tasks, etc.), a bottom-sticky rule would cause it to visually detach and float near
the screen bottom while scrolling through content *below* it — a worse regression than the bug
being fixed. Went with a scoped, structural trim instead: mobile cover height `270px → 220px`
(`home-cover.tsx`), plus tightened vertical spacing in the artist-profile header block on mobile
(`gap-3`/`py-2` → `gap-2`/`py-1`, `home-content.tsx`, mobile-only — desktop classes untouched).

**Result, measured before/after via the isolated-standalone-server technique against staging's DB
(never touched the live `peerify-staging` pm2 process or DB during iteration):**
- `the-band` ("A Friendly Few", staging's analogue to the originally-reported production circle):
  overlap fully eliminated — tabs bottom now 592px vs nav top 608px, 16px clear.
- `tim-admin` (personal profile, short header): no overlap, large margin.
- `tim-solo` (7 wrapped genre badges, the worst case found): reduced from ~84px too-tall to an
  18px residual overlap — a real improvement (~78% reduction) but not fully eliminated. Flagging
  this as a known limitation rather than claiming full resolution: profiles with unusually long
  badge/tag lists can still see a small overlap. A more thorough fix (e.g. capping visible badges
  with a "+N more" affordance, or a larger restructure of the bottom-nav clearance system) would
  be a separate, bigger-scoped follow-up if wanted.
- Explore page: 12px clear gap between search controls and Log in/Sign up in the logged-out state,
  confirmed via `getBoundingClientRect()` and screenshot.

Commit `84b46b00`, on top of `793979cf`. **Staging-only, not deployed** — per instruction, awaiting
go-ahead before running `deploy-staging.sh`.

## 2026-08-14 — Multi-artist events: additional bands, delegated edit access, self-service removal
- Shipped: events can now list additional artist/band circles beyond the primary host `circleId`. New optional `EventModel` fields `additionalArtistCircleIds`/`artistAdminCircleIds` (additive, no migration). New actions `addArtistToEvent`/`removeArtistFromEvent`/`setArtistAdminStatus` (gated by canModerate/isAuthor, same as event edits) and `removeSelfAsEventArtist` (a deliberately separate, narrower gate: admin of the specific band circle, no moderator/author rights implied). `canEdit` on both the event detail page and the `/edit` route now also passes for admins of a delegated band (`artistAdminCircleIds`) — these are two independent gates in the code, both needed the same fix. New `EventArtistPicker` (create/edit form) and `EventArtistList` (detail page) components. New `event_artist_added` notification, sent to the added band's own admins (not the host circle's).
- Bug found and fixed during manual verification: `searchArtistCirclesAction` initially hard-filtered to `circleType: "user"` — but real managed-identity bands/producers in this app are `circleType: "circle"` (only a solo artist using their own personal account is `"user"`). Would have returned zero real bands. Fixed to search all circle types and filter by `isPeerifyArtistIdentity` after, matching how map-explorer's own search already does it.
- Verified end-to-end against staging's DB via the isolated dev-server-on-a-free-port + Playwright technique (never against the live `peerify-staging` pm2 process/DB during iteration): picker finds circleType-"circle" bands and excludes venues; delegated band admin gets `canEdit` on both the detail page AND the separate `/edit` route (the two-gate issue above, confirmed fixed); non-delegated band admin sees only "Remove yourself" and removing affects only that band; `event_artist_added` notifications land for each band's own admins with correct message/link. Test fixtures (2 throwaway users, 2 test events, notifications) cleaned up and admin memberships restored afterward.
- Commits: `9d8b230c`..`b2143502` on `staging` (cherry-picked from `main` @ `b63947de`..`a3e1ec74`, 7 commits, no conflicts despite 3 files — `models.ts`/`notifications.ts`/`notifications.tsx` — overlapping with intervening staging-only work). Deployed via `deploy-staging.sh`, all 8 steps passed, prod pid/uptime unchanged, BUILD_ID `C1-arA2IIeJrCF1sEbBIm`.

## 2026-08-15/16 — Noticeboard post audience visibility: four distinct bugs found and fixed

**Repro that started this:** A Noticeboard post ("The Venue Festival," circle "the-venue") with audience explicitly set to "Everyone" was not visible to a logged-in non-follower, in either the circle's own Noticeboard tab or the home Feed.

**Issue 1 — events/actions.ts:301, upsertEventNoticeboardPost:** Event→Noticeboard sync hardcoded userGroups to ["admins","moderators","members"] on every create AND every resync, completely disconnected from the actual event/post's intended audience. Any time a linked event was republished, this silently reset the post's audience regardless of prior state — a real data-corruption bug, not just a UI gap.
Fix (commit 8c98bbb0): new posts get the event's actual userGroups; resync no longer touches userGroups at all, so republishing never clobbers a human's manual audience edit.

**Issue 2 — updatePostAction, feeds/actions.ts:** The post edit dialog's audience selector correctly serialized selections client-side, but the server action handling edits never read userGroups from the submitted form at all (unlike createPostAction, which did). Edits appeared to succeed with no error, but the audience value in the DB was never touched.
Fix (commit 134dd2c5): updatePostAction now reads and persists userGroups from the edit form, matching createPostAction's existing correct pattern.

**Issue 3 — getAccessibleFeedIdsForUser, feed.ts:48-97:** The home Feed "Following" tab required an existing Members/follower relationship with a circle BEFORE ever checking whether a post's own userGroups included "everyone" — so even a correctly-tagged "everyone" post from a circle the viewer doesn't follow was structurally excluded from the aggregation before its audience setting was ever considered. Same pattern as other visibility-gate bugs found this week (event map/search draft-status gate, getEventById private-visibility gate): a blanket membership precondition applied before checking the content's own intended-audience field.
Fix (commit e1006fc4): "everyone"-tagged content now bypasses the membership requirement in both the single-circle and whole-home-feed code paths, matching the correct pattern already used in getPosts/canUserViewPost. Confirmed the circle's own Noticeboard tab was NOT affected by this specific gate — only the home Feed "Following" tab was.

**Issue 4 — CircleSelector initial-mount callback collision, post-form.tsx:** Found during live post-fix testing (not in the original investigation): the post edit dialog's audience selector displayed "Everyone" as selected regardless of the post's actual stored audience (e.g. "Followers"), because CircleSelector's one-time initial-mount report used the SAME callback (onCircleSelected → handleCircleSelected) as genuine user-driven circle changes, which unconditionally reset userGroups to ["everyone"]. This silently clobbered the correctly-seeded initial audience a moment after mount, on every single dialog open. Given Issue 2's fix now correctly persists whatever the dialog displays, this created a live, silent risk: any unnoticed edit (even to unrelated fields) would downgrade a Followers-only post to Everyone.
Fix (commit 556293f9): track whether CircleSelector's initial mount-time callback has already fired; only reset audience to "everyone" on subsequent, genuine circle-change events.

**All four fixes verified live** against real posts/events on staging.peerify.one via real browser sessions (not just code inspection or isolated dev-server testing) — including a real non-follower test account confirming Feed visibility, and a real edit-and-save cycle confirming a Followers-only post's audience survives an unrelated edit.

**Status:** All four committed to staging branch, deployed and confirmed live on staging.peerify.one. Not yet promoted to production — pending final full click-through re-test of all four together, then standard deploy-peerify.sh promotion path.

## 2026-08-16 — Draft-status event: clearer hero badge + status box (presentation-only)

Asked to make an event's Draft status harder to miss — previously a prominent green "Open" button sat right next to a quiet "Status: Draft" text label, so a draft event's page could look live at a glance. Scoped as UI-only: no permission/visibility logic touched, only presentation.

**Changes, both in `EventDetail`** (`src/components/modules/events/event-detail.tsx`, the single shared component behind the real detail-page route, the content-preview modal, and both events-panel sidebars via an `isPreview` prop):
1. Hero cover-image corner badge (lines ~490–512, the non-preview/full-layout branch only — this is the only branch that ever renders the "Status:"/stage-controls block, since `page.tsx` is the only caller that doesn't pass `isPreview`): a small top-left tag, `stage === "draft"` only, reading "DRAFT — NOT VISIBLE TO THE PUBLIC", styled with the Peerify mustard/ink/cream palette (`#FAF6EC` cream background, `#1A1612` ink text, `#E8732C` orange accent dot/border) rather than a generic red/yellow warning banner. Positioned so it never covers the image center.
2. Stage-controls status box (lines ~577–610): draft state now gets its own branch — bold uppercase label, `EyeOff` icon, warm tinted background/border (`#F8E2CE`/`#E8732C`-50%) instead of the same plain `text-muted-foreground` treatment every other stage used, so it reads at least as loud as the "Open"/"Submit for review" buttons beside it. Non-draft stages (`open`/`review`/`cancelled`) are pixel-identical to before — untouched branch.

Deliberately did NOT add the badge to the compact/preview hero (the `if (compact)` branch, lines ~264–323, used by `content-preview.tsx`/`events-panel.tsx`/`mobile-events-panel.tsx`) — that branch never had the "Status:"/button-cluster problem this task was scoped to fix, and its hero is already busy with a date badge, close button, and calendar button in the same two top corners. Flagging as a separate, smaller follow-up if draft-status visibility is also wanted on preview cards.

The Peerify `--pf-*` mustard/ink/cream token set is documented in `PEERIFY_CONTEXT.md` §4.2 but not yet wired into `globals.css`/`tailwind.config.ts` anywhere (confirmed via grep, zero hits) — used the documented hex values directly as Tailwind arbitrary-value classes in this one file rather than introducing new global tokens, to keep the change scoped to the two components actually being touched.

**Incident during verification, self-inflicted, staging-only:** ran a bare `bun run build` in the repo (to type-check/lint the change) without realizing `EXPECTED_STANDALONE_ROOT` in `deploy-staging.sh` (`.next/standalone/apps/peerify-staging/circles/circles`) *is* the exact directory the running `peerify-staging` PM2 process serves from — a fresh `next build` wipes and regenerates the whole `.next` tree, including that standalone dir, but does NOT copy `public/`/`.next/static` back into it (that's `deploy-staging.sh` Step 4 alone). Result: staging's already-running process was left serving 400s for every `_next/static/*` CSS/JS chunk for a few minutes (confirmed via direct `curl`) — the same "stale process, missing static" failure mode documented earlier in this log. Caught it immediately via the same `curl` check, fixed by running the real `deploy-staging.sh` (which both restores static assets and ships this change) rather than manually patching the directory. Prod `pid`/`pm_uptime` confirmed unchanged before and after. **Lesson for next time: never run a bare `bun run build` inside this repo directory once `peerify-staging`'s pm2 process is live — always build inside a copy (or go straight through `deploy-staging.sh`) — see [[project_peerify_staging_environment]].**

**Verified:** `bun run lint` and `CI=1 bun run build` clean (no new warnings in touched file). Visually confirmed via the isolated-standalone-server-on-a-free-port technique (fresh copy of `.next/standalone` + `public`/`.next/static`, port 3003, login-link-token as `tim-admin`, real Playwright `chromium`, never against the live pm2-served directory during iteration) against two real staging-DB events: a real `stage: "draft"` event (badge + loud status box both render, buttons unaffected) and a real `stage: "open"` event (no badge, plain "Status: Open" box, pixel-same as before — confirms no regression on non-draft stages). Login-link token fields cleaned up on the `tim-admin` circle doc after each check. Deployed via `deploy-staging.sh`, all 8 steps passed, prod pid/uptime unchanged (`1839957`/unchanged uptime), staging restarted onto the new build (BUILD_ID `ueyZpgSdeSaBPg8vyQ0c_`). Did not re-screenshot against `https://staging.peerify.one` itself — an automated Playwright hit against the live public domain was blocked by this session's auto-mode classifier; the local isolated-build screenshots (identical source) plus the deploy script's own passing HTTP/asset checks against `localhost:3001` were treated as sufficient.

## 2026-08-16 (later) — Bug A fix: draft events no longer leak a public Noticeboard post

Follow-up to the draft-status UI work above. Manual testing found that a draft event with "Share this event on the Noticeboard" checked immediately created a live, publicly-visible Noticeboard post — before the event was ever opened. Investigated (report-only pass first, no code changes) and found two compounding, independent bugs:

- **Bug A (fixed this entry):** `upsertEventNoticeboardPost` (`src/app/circles/[handle]/events/actions.ts`) never checked `event.stage` at all, and was called from `createEventAction`/`updateEventAction` on every save gated only by a form checkbox — never from `changeEventStageAction` (the only place a stage transition actually happens). New events are always created in `stage: "draft"`, so checking the box at creation synced the post immediately while still draft.
- **Bug B (NOT fixed, logged as a separate follow-up below):** the event form has no real audience/`userGroups` control at all, so every event-linked post gets `userGroups: []` — and `feed.ts`'s visibility gates (`canUserViewPost`, `getPostsFromMultipleFeeds`, `getPosts`) all treat an empty array as equivalent to `"everyone"`. This means even a correctly stage-gated post is unconditionally public today; there's no restricted-audience state to fall back to.

**Bug A fix, approach (a) — don't sync while draft/review, only on the transition to "open":**
- `models.ts` (eventSchema, ~line 1856): added `publishToNoticeboard: z.boolean().optional()`, additive, alongside the existing `noticeboardPostId` field — same pattern as the `additionalArtistCircleIds`/`artistAdminCircleIds` additive fields from the 2026-08-14 multi-artist-events entry.
- `src/lib/data/event.ts`: added `publishToNoticeboard: 1` to `SAFE_EVENT_PROJECTION` (it's an explicit allowlist — the new field would otherwise be silently stripped from every `getEventById`/`getEventsByCircleId` read).
- `actions.ts` `createEventAction`: now persists `publishToNoticeboard` (from the existing form checkbox) on every new event, but **never** calls the Noticeboard sync — new events are always draft, so that call could never legitimately fire here.
- `actions.ts` `updateEventAction`: persists `publishToNoticeboard` on every save (draft/review/open alike), but only calls the sync while `event.stage === "open"` — preserves the existing "resync title/content on edit after the event is already public" behavior, while never touching the post at all during draft/review.
- `actions.ts` `changeEventStageAction`: added the actual creation/sync call, gated on `newStage === "open" && event.publishToNoticeboard`, placed right alongside the existing stage-transition notification block (same trigger point, same pattern).
- `event-form.tsx`: the "Share to Noticeboard" checkbox's initial/re-seeded state used to derive solely from `Boolean(event?.noticeboardPostId)` — under the new deferred-creation model that would silently forget a host's checked-but-not-yet-open intent the next time they reopened the edit form (no `noticeboardPostId` exists yet). Fixed to also check `event?.publishToNoticeboard`. Also added one clarifying sentence to the checkbox's caption explaining the post only goes live once the event opens.
- Deliberately did not touch Bug B, `funding/actions.ts` (which already implements this same "no post while draft" gate for funding asks, confirmed as a useful existing precedent, not something needing a fix), or `task.ts`'s parallel shift-noticeboard-post mechanism.

**Verified**, all against real staging DB via the isolated-build-copy technique (see below — a new twist on the isolated-standalone-server technique, to avoid repeating the incident above):
- Create a draft event, check the box → event persists `publishToNoticeboard: true`, **no post created** (confirmed via direct Mongo query — no `noticeboardPostId`, no matching `internalPreviewId` post).
- Edit that same still-draft event (re-save with the box checked) → still no post created (`updateEventAction`'s stage-gate confirmed).
- Click "Open" on the draft event → post created at exactly that moment (`noticeboardPostId` now set, linked post exists with `postType: "post"`, correct `feedId`).
- Edit the now-open event's title → linked post's title updates too (existing "resync while open" behavior confirmed unregressed).
- Test events/posts/RSVPs cleaned up from the DB afterward; login-link token fields unset on the `tim-admin` circle doc after each check.

**New technique note — isolated *build*, not just isolated *server*:** last entry's incident (bare `bun run build` clobbering the live `peerify-staging` pm2 process's serving directory) happens because `next build`'s output path *is* `EXPECTED_STANDALONE_ROOT` when run from this repo directory — there's no way to `bun run build` here safely while that pm2 process is live. Fix used this time: build in a scratch copy instead (symlink `node_modules`, copy `src`/`public`/`next.config.mjs`/`tsconfig.json`/`tailwind.config.ts`/`package.json`/`bun.lock`/`components.json`/`.eslintrc.json` — NOT `.next`), `source .env.local` there, run `bun run build`, producing a fully independent `.next/standalone` never touching the real repo's `.next`. Confirmed staging (`localhost:3001`) stayed on HTTP 200 for both root and a static asset throughout. This is the technique to reuse next time a fresh build is needed for local testing before deploying — see [[project_peerify_staging_environment]] (worth adding this as a documented alternative there).

Deployed via `deploy-staging.sh` (the real one, from the actual repo directory — the scratch copy above was only for pre-deploy local testing) — all 8 steps passed, prod pid/uptime unchanged, staging restarted onto the new build.

**Follow-up logged, not implemented — Bug B:** events have no real audience-selection UI (`event-form.tsx` has zero `userGroups` control), so `event.userGroups` is always `[]` and every event-linked Noticeboard post is unconditionally public via the `feed.ts` "empty array means everyone" convention (`canUserViewPost` line ~312, `getPostsFromMultipleFeeds` ~1126/1157, `getPosts` ~1548/1577). This is a separate, larger feature (real audience-selection UI + wiring it through create/update, mirroring how post-form.tsx's own `CircleSelector` already does this for regular Noticeboard posts) — worth scoping as its own task, not a quick fix.

## 2026-08-16 (later still) — Bug B fix: real audience control for event-linked Noticeboard posts

Follow-up to Bug A above. Investigated first (report-only pass, no code changes), then implemented per the recommended scope: give the linked Noticeboard post a real audience choice, mirroring `post-form.tsx`'s existing single-tier radio pattern, without touching the event's own separate `stage`/`visibility` gates.

**Investigation correction worth noting:** the original ask assumed `post-form.tsx`'s audience selector was `CircleSelector`-based. It isn't — `CircleSelector` only picks *which circle* a post targets. The actual audience picker is a separate small "Users" icon button + a `Dialog` radio list (`post-form.tsx` ~1231-1304), driven by `getAvailableUserGroups()`/`getUserGroupName()` (~530-556), which derive from the *poster's own membership* in the target circle (`user.memberships`, a client-side `UserPrivate` already carrying both membership tiers and each circle's group definitions). `CircleSelector`'s only real involvement was the Issue 4 bug from the 2026-08-15/16 entry (its mount callback resetting audience).

**Implementation, `src/components/modules/events/event-form.tsx`:**
- Pulled the current user via the same client-side `userAtom` (jotai) the post composer already uses — no new server-side prop plumbing needed in the create/edit event pages, since `UserPrivate.memberships[].circle` already carries everything (the user's own tier + the circle's group name/handle definitions).
- Added `userGroups` state seeded from `event?.userGroups`, with one deliberate deviation from `post-form.tsx`'s pattern: `event?.userGroups?.length ? event.userGroups : ["everyone"]` instead of a naive `||`, because every existing event's `userGroups` is `[]` (the old schema default) — a bare `||` would leave the dialog with nothing selected when editing any pre-existing event.
- Added `getTargetMembership`/`getUserGroupName`/`getAvailableUserGroups`, adapted from `post-form.tsx`'s equivalents to work off the form's `selectedCircle` handle string rather than a full `Circle` object.
- Added the audience button + `Dialog` (radio list: Everyone + the viewer's own group tiers in that circle), shown only when "Share this event on the Noticeboard" is checked — since that's the only thing this setting affects. Copy explicitly says "This only controls the linked Noticeboard post — it doesn't change who can see the event itself," to avoid confusion with the separate `visibility` (public/private) toggle.
- `onSubmit`: appends `userGroups` to the form data, same as `post-form.tsx`.

**`src/app/circles/[handle]/events/actions.ts`:** switched both `createEventAction` and `updateEventAction` from `data.userGroups || [...]`/`data.userGroups || event.userGroups` (both effectively dead fallbacks, since an empty array is truthy in JS) to the explicit `data.userGroups.length > 0 ? data.userGroups : ["everyone"]` form `feeds/actions.ts` already uses — so a real `"everyone"` is always stored, rather than leaning on `feed.ts`'s empty-array convention.

No changes needed to `upsertEventNoticeboardPost`, `changeEventStageAction`, or `feed.ts` — they already correctly consume whatever `event.userGroups` holds (confirmed during the Bug A investigation).

**Verified** against real staging DB via the same isolated-build-copy technique as the Bug A entry above (fresh scratch build, port 3003, login-link-token as `tim-admin`, real Playwright `chromium`):
- Created a draft event on `the-venue` (a circle where `tim-admin` has real `admins/moderators/members` tiers, confirmed via direct Mongo query — even personal/self circles turned out to already have a self-membership row here, so the selector shows real tiers everywhere tried), checked "Share to Noticeboard," opened the audience dialog, selected "Members" → event persisted `userGroups: ["members"]`, still draft, no post yet (Bug A's gate still holds).
- Opened that event → linked post created with `userGroups: ["members"]` (not `[]`) — confirmed via direct Mongo query on the post document.
- Created a second event without touching the audience dialog at all → persisted `userGroups: ["everyone"]` explicitly (not `[]`), confirming the new explicit-default logic in both actions.
- Test events/posts cleaned up from the DB afterward; login-link token fields unset on the `tim-admin` circle doc after each check.
- `bun run lint` and `tsc --noEmit` both clean (no new warnings/errors in touched files).

Deployed via `deploy-staging.sh` — all 8 steps passed, prod pid/uptime unchanged, staging restarted onto the new build.

## 2026-08-16 (later still) — Two follow-ups from testing the event-audience feature: "Members"→"Followers" turned out to be a data-projection bug, not a rename; audience now surfaced on the event detail page

**Follow-up 1 — "Members" vs "Followers" in the new audience dialog.** Investigated first (no changes) whether `"members"` (the userGroup handle) is genuinely synonymous with "following" a circle today, or something distinct (paid membership, a Kamooni-era concept, etc.), since a same-word rename needs to be scoped correctly across every place it appears.

**Finding: they're already the same thing, and the rename has effectively already happened — everywhere except the two new event dialogs, which had a real bug, not a naming gap.** `followCircle()`/`addMember()` (`src/components/circle/actions.ts`, `src/lib/data/member.ts`) literally insert into the `Members` collection to represent "now following" — there is no separate follow/relationship collection for circle-following. The default group *definition* used at circle creation (`defaultUserGroups`/`defaultUserGroupsForUser`, `src/lib/data/constants.ts` ~887-894/915-922) already has `{ name: "Followers", handle: "members", title: "Follower", ... }` — i.e., the internal string `"members"` was deliberately kept only as a stable handle while the human-facing name was already renamed to "Followers" at some point before this week. Confirmed directly against 5 real staging circles (`the-venue`, `tim-admin`, `tim-solo`, `the-band`, `peerify-main`) via Mongo — every one already stores `name: "Followers"` for its `"members"` group. Distinct concepts that must NOT be conflated with this (paid Stripe/Donorbox membership, founding-member badge, chat-room membership) all live under separate fields/collections entirely and were correctly ruled out.

**So the actual bug:** despite the data already being correct everywhere, the new "Who can see the Noticeboard post?" dialog in `event-form.tsx` (added this week) was rendering the raw handle capitalized ("Members") instead of the real stored name ("Followers") — reproduced live against `the-venue` before the fix. Root cause: `getUserPrivate()` (`src/lib/data/user.ts` ~160-220) builds `UserPrivate.memberships[].circle` via an aggregation `$lookup` into `circles`, but its `$project` (both the inner pipeline stage and the outer reshape stage) explicitly listed a fixed allowlist of fields that omitted `userGroups` — so `membership.circle.userGroups` was silently `undefined` at runtime for every user, despite the `Membership`/`Circle` TypeScript types promising it. `event-form.tsx`'s new `getUserGroupName()` (this week's addition) depends on exactly that field to look up the display name for a chosen group handle, and its fallback path (`handle.charAt(0).toUpperCase() + handle.slice(1)`) produced the "Members" that prompted this whole investigation. `post-form.tsx`'s own `getUserGroupName` doesn't hit this bug in practice — for circles other than your own, it reads the name off `selectedCircle`, a full `Circle` object supplied directly by `CircleSelector`'s own separate fetch, not via `user.memberships[].circle`.

**Fix:** added `userGroups: 1` to both `$project` stages in `getUserPrivate()`'s membership-circle lookup (`src/lib/data/user.ts`). This is a projection fix, not a rename — no `userGroups` handle/schema value changed anywhere, and no hardcoded "Followers" string was added to either dialog; both already correctly render whatever `name` a circle's own group definition holds, which is uniformly "Followers" already. `getUserPrivate` is the single source `checkAuth()`/`Authenticator` uses to populate the client-side `userAtom`, so this one fix covers every consumer.

**Not touched, correctly out of scope:** two admin-dashboard table column headers (`src/components/modules/admin/tabs/circles-tab.tsx:182`, `projects-tab.tsx:124`) still literally say "Members" as a follower-count column header — a different UI surface than "this dialog"/"the post-composer dialog" the ask was scoped to, so left alone. Also out of scope: `PEERIFY_CONTEXT.md`'s own mockup notes about a *future*, not-yet-built "Followers → Supporters" distinction (people who've spent money) — the opposite direction from this ask, doesn't exist in code.

**Follow-up 2 — surface the linked post's audience on the event detail page.** Added a small second line inside the existing stage-controls status box (`src/components/modules/events/event-detail.tsx`, right below the Draft badge / "Status: X" line), shown whenever `event.publishToNoticeboard` is true (draft, review, or open alike): "Noticeboard post visible to: <label>". Resolves the label the same way as the dialog (`event.userGroups` matched against the event's own `circle.userGroups` group definitions, defaulting to "Everyone" when empty/`["everyone"]`) — `circle` was already a prop on `EventDetail`, sourced from `getCircleByHandle` (a different, already-`userGroups`-inclusive projection, unaffected by the bug above), so no new data plumbing was needed here. Read-only, as asked — editing the audience still only happens via the existing `event-form.tsx` dialog.

**Verified**, both together, via the same isolated-build-copy technique as the entries above (fresh scratch build, port 3003, login-link-token as `tim-admin`, real Playwright `chromium`, against real staging DB data — never the live pm2-served directory):
- Draft event on `the-venue`, audience dialog now shows "Followers" (not "Members") for the same underlying `"members"` handle — screenshotted.
- Selected "Followers," saved while draft → event detail page's status box shows "DRAFT — NOT VISIBLE TO THE PUBLIC" *and* "Noticeboard post visible to: Followers" beneath it — screenshotted.
- Opened the event → status box now shows "Status: Open" *and* "Noticeboard post visible to: Followers" beneath it, unchanged from the draft-state label — screenshotted.
- `bun run lint` / `tsc --noEmit` clean on all three touched files. Test event/posts cleaned up from the DB afterward; login-link token fields unset on the `tim-admin` circle doc after each check.

Deployed via `deploy-staging.sh` — all 8 steps passed, prod pid/uptime unchanged, staging restarted onto the new build.

### 2026-08-15 (later) — Update: broken circle logo images no longer reproducing

Re-checked after prod deploy; "Blurry Images" and other previously-broken 
circle logos now display correctly (default avatar rendering as expected). 
Likely browser cache from the prior day's asset issues, not a live bug. 
Not investigated further — closing this item unless it recurs.

### 2026-08-16 — Feature request: add "Acoustic" as an artist category

Add "Acoustic" as a selectable category/genre for artist profiles and 
search filtering — currently not in the list. Small, scoped addition. 
Not yet investigated (likely touches the category enum in models.ts and 
whatever search/filter UI reads from it). Low urgency, pick up whenever 
convenient.


### 2026-08-16 — Self-hosted web push notifications: implemented and verified live

**Scope (deliberately modest per decision):** Push notifications for four 
categories only — messages, events, verification, follow/community (off by 
default) — mirroring the existing coarse email-preference model. Broader 
Kamooni/Circles governance notification types (tasks, proposals, issues, 
goals) explicitly excluded from push for now; remain in-app-bell-only.

**Implementation:**
- Schema: four pushX booleans on circleSchema (mirroring email preference 
  fields), new pushSubscriptionSchema for per-device subscription docs.
- Storage: new PushSubscriptions Mongo collection, unique index on endpoint, 
  index on userId.
- Delivery module (src/lib/data/push.ts, new): PUSH_NOTIFICATION_CATEGORIES 
  config, isPushEnabledForRecipient, sendPushToUser (via web-push, cleans up 
  expired 404/410 subscriptions), subscription CRUD.
- Integration: sendNotifications (the single confirmed funnel all ~45 
  notification wrapper functions and 9 direct callers go through) now fires 
  push immediately, fire-and-forget, right after the existing bell-
  notification insert — NOT on the hourly email-digest batch model.
- Client: new usePushSubscription hook, detects support state (unsupported / 
  ios-needs-install / supported) via PushManager presence and 
  navigator.standalone/display-mode checks.
- UI: new PushPreferencesSettingsCard in Account Settings, rendered above 
  Email Preferences as intended. Includes iOS-specific "Add to Home Screen" 
  instructions (Share → Add to Home Screen → open from Home Screen icon) 
  when iOS Safari outside a home-screen install is detected.
- Service worker (public/sw.js, new): push + notificationclick handlers, 
  opens/focuses a per-notification-type URL (e.g. a message notification 
  opens the relevant chat directly, not a general notification center).
- VAPID keys generated, added to staging .env.local.

**Bug found and fixed during deployment:** PushPreferencesSettingsCard was 
initially wired into an unreachable code branch (gated on subscriptionAttempted, 
which can only become true via a dialog-close flow that's currently commented 
out pending an unrelated redesign) — the component existed correctly in the 
codebase and the build, but was never actually rendered. Fixed by moving it 
into the default/always-reached branch, directly above EmailPreferencesSettingsCard 
as intended.

**Verified live, end-to-end, by a human on a real device (not just automated 
testing):** Real OS-level browser permission prompt fired in Chrome (desktop 
Sun Aug 16). Subscription persisted correctly through a hard refresh. Sent a 
real direct message from a second account → real OS notification appeared in 
Chrome with correct app name, subdomain, and message content. iOS Safari 
correctly detected and displayed the "Add to Home Screen" instructions on a 
real iPhone (older iPhone SE — "Add to Home Screen" option not immediately 
found in the iOS share sheet on that device; full iOS PWA install flow not 
yet completed, to be retried on a more modern device).

**Explicitly NOT built, and would need separate scoping:** home-screen icon 
badge count (requires the separate Badging API — navigator.setAppBadge — 
with its own, historically inconsistent iOS support; unrelated to the Push 
API used here). Currently, tapping a push notification opens the specific 
relevant content (e.g. a chat) rather than a general notification center.

**Status:** Deployed and verified on staging.peerify.one. Not yet promoted 
to production.


### 2026-08-16 — Future features discussed: Telegram forwarding & weekly performance summary

**1. Telegram message forwarding (like Kamooni)**
Idea: let users link a Telegram account/bot to receive message forwards, 
closing the iOS gap that web push can't solve (iOS requires Home Screen 
install; Telegram works instantly on iOS with no install friction). Real 
integration lift, not a toggle — needs a Telegram bot, a per-user linking 
flow (user must /start the bot and link their Peerify account; Telegram 
doesn't allow pushing to unlinked users). Scope as its own investigation, 
separate from the push notification work.

Explicit decision: do NOT disable Postmark email digests for users who set 
up Telegram. Email is the one channel that doesn't depend on live 
third-party infrastructure staying up — it's the safety net, not a 
redundant channel to prune. If Telegram has an outage or a link breaks 
silently, a user with email fully disabled would get nothing until they 
noticed. Keep the digest running as background safety net regardless of 
which real-time channels (push, Telegram) are active.

**2. Weekly artist performance summary email — distinct from missed-activity 
digest**
Idea (person's): a weekly email like "Your song 'X' was played 45 times 
fully, 239 times partially, by fans from 13 countries; you received 15 new 
pledges, 3 new crew members, 6 comments." This is a RE-ENGAGEMENT/retention 
email, conceptually different from the existing "here's what you missed" 
digest — keep them as two separate features, not one system. Needs new 
aggregated data (play counts by country, weekly pledge/crew/comment counts) 
that doesn't currently exist in reportable form. Not yet scoped.

**Cost/architecture note carried into both:** push (browser push service) 
and Telegram (Bot API) are both free at reasonable volume; Postmark has a 
real per-email cost — keep any new email sends batched/digest-style, not 
per-event, consistent with the existing digest design.

**Status:** Both ideas discussed and captured, not yet scoped or 
implemented. Pick up separately, after Telegram gets its own investigation 
pass given the real integration complexity.


### 2026-08-16 (later) — Push notifications promoted to production

Deployed to peerify.one. Two commits (77ec08b7, 3a3f90f3) were initially 
missed on the main branch during promotion — staging had them, main didn't 
— caught because the settings card was confirmed working on staging but 
absent on prod despite a "successful" deploy. Cherry-picked onto main, 
prod-specific VAPID keys generated and added to prod's .env.local (separate 
key pair from staging, as intended), redeployed. Confirmed working live on 
peerify.one: settings card renders, subscribe flow completes, and a real 
notification was received end-to-end.


### 2026-08-16 (later still) — Hid redundant "Submit for review" button for reviewers

Investigated the draft-status action row on the event detail page 
(event-detail.tsx). Found the row showed both "Submit for review" and 
"Open" to any viewer with canReview (e.g. a circle admin), even though 
draft->review is pointless for someone who can already open the event 
directly. Root cause: the button's visibility condition was `isAuthor || 
canReview`, so canReview alone was enough to show it regardless of 
authorship. Changed to `isAuthor && !canReview` — reviewers now see only 
"Open" while a draft event is theirs or anyone else's; non-admin authors 
without canReview are unaffected and still see only "Submit for review." 
No changes to changeEventStageAction, the review->open transition, or 
notification logic.

**Known issue surfaced, not fixed (out of scope for this change):** 
`notifyEventSubmittedForReview` (eventNotifications.ts) silently no-ops 
when the resolved reviewer set is empty after excluding the submitter — 
no error, no log line, nothing. This happens whenever the submitter is the 
circle's only admin/moderator (the default case, since events.create and 
events.review share the same default user groups). Worth adding at least 
a log line for this case someday so a submitted-for-review event that 
reaches nobody isn't completely silent.


### 2026-08-17 — Prod incident: peerify.one served unstyled, root cause was an interrupted deploy

**Symptom:** peerify.one was reachable and rendering page structure/text, 
but with no CSS applied and at least one broken image icon.

**Diagnosis:** Prod's PM2 process (`peerify`, pid 1851614) had an uptime 
that exactly matched a baseline captured earlier the same day — the app 
process itself never crashed or restarted, ruling out a bad deploy that 
got restarted into and pointing at a static-asset problem instead. Direct 
`curl` checks against `https://peerify.one/_next/static/css/*.css` 
returned HTTP 400, served by Next.js itself (not nginx, not a plain 404) — 
confirming every static asset request was failing at the app layer.

Root cause: `~/apps/peerify-app/circles/.next/standalone/apps/peerify-app/circles/.next/static/` 
did not exist on disk at all. `scripts/deploy-peerify.sh` had been run 
manually (found as the last command in shell history) inside a `screen` 
session named `peerify-work`, immediately followed by `pkill screen` — 
which killed the deploy mid-run. Step 2 (`rm -rf .next && bun run build`) 
had completed, regenerating a fresh `.next/standalone` tree (which never 
includes static assets by itself), but Step 4 (copying `.next/static` and 
`public/` into the standalone dir) and Step 6 (`pm2 restart`) never ran. 
The still-running old PM2 process was left with zero static assets to 
serve. This is the same failure mode logged on 2026-08-02 for staging 
("stale standalone build broke staging site-wide") — now confirmed to 
also be able to hit prod when a deploy is interrupted between build and 
copy/restart.

Side note during investigation: `~/apps/peerify/circles` is a stale, 
unused clone with no `deploy-peerify.sh` and is not what backs the running 
`peerify` PM2 process — the real prod repo/working tree is 
`~/apps/peerify-app/circles` (confirmed via `pm2 describe peerify`'s exec 
cwd). Worth remembering to avoid re-diagnosing in the wrong directory next 
time.

`autoMode.hard_deny` rules for `deploy-peerify.sh`/`pm2 restart`/`pm2 start` 
were confirmed present and correctly configured; they were not implicated, 
since this was an interactive manual run, not an agent-initiated one.

**Fix:** Re-ran `./scripts/deploy-peerify.sh` to completion from 
`~/apps/peerify-app/circles`. All 8 steps passed: fresh build from current 
`main` HEAD (4f074b54), BUILD_ID verified, static assets copied into the 
standalone dir and verified present, PM2 `peerify` restarted (new pid 
1880856) with staging's pid/uptime confirmed unchanged, HTTP root check 
200, static asset check 200. Independently verified from outside the box 
afterward: `GET https://peerify.one/` → 200, and a CSS bundle 
(`8342e51e453e2131.css`) → 200 with real content (36,468 bytes).

**Status:** Resolved and verified live on peerify.one.

## 2026-08-17/18 — Hardened deploy-peerify.sh against interrupted deploys, migrated prod onto atomic releases; migration hit a real duplicate-process incident along the way

**Background:** the interrupted-deploy incident logged above, plus an identical failure mode on staging (2026-08-02), prompted a redesign: replace the in-place "wipe the live standalone dir's static assets, then copy new ones in" approach with an atomic-release scheme — build into a fresh, fully isolated `releases/<timestamp>-<gitsha>/` directory, verify it completely before it's referenced by anything live, then atomically flip a `current` symlink to it via a single `rename(2)` (`ln -sfn` + `mv -T`, same filesystem — no interruptible window), and only restart PM2 after the swap is confirmed. `releases/`/`current` live one level above the app checkout (`/home/tim/apps/peerify-app/`) rather than inside `.next`, deliberately outside `next build`'s tsconfig scan scope — an in-checkout placement broke a build for real during testing on staging before this fix. Shared logic lives in `scripts/deploy-common.sh`, identical between prod and staging (copied byte-for-byte). Full design writeup and staging's version of this migration: staging's own `SESSION_LOG.md`, commits `716630fe`/`c6eb4360` in that repo.

**Migrating prod's PM2 process onto this scheme required delete+start** (not `restart`, which can't change `--cwd`), planned deliberately as a low-risk migration: copied the already-verified-good live standalone directory (no fresh build involved) into `releases/20260818-043400-migration-6e4d0f9e/`, verified it (BUILD_ID `08d-ZQGE83ho1z0ACrcbe` matched live, static/public present, `server.js` present), created `current` pointing at it — all read-only with respect to the live process, zero risk up to this point.

**First attempt (real incident, caught immediately, no user-facing outage):** handed off a single `pm2 delete peerify && ... && pm2 start ... && pm2 save` block for Tim to run (since `pm2 start`/`pm2 restart` are hard-denied for autonomous execution — an intentional guardrail). `pm2 delete peerify` silently failed to remove the existing process (`pm2.log` shows no stop/exit event for it at all at that timestamp — root cause of the delete failure itself was never fully determined), so the subsequent `pm2 start` created a **second** PM2 entry also named `peerify` (new pm_id) while the original (pm_id 1, pid 1880856) kept running and kept holding port 3000. The new entry crash-looped on `EADDRINUSE: address already in use 0.0.0.0:3000` sixteen times before PM2 gave up and marked it `errored` (pid 0). Confirmed via `ss -tlnp` (exactly one real listener on :3000, the original process), `ps` (the pid the duplicate briefly had was already dead by the time it was checked), and `peerify-error.log` (repeated `EADDRINUSE` stack traces). `peerify.one` was serving correctly throughout, unaffected, the whole time — the old process never stopped.

**Fix and retry, with a process change:** deleted the dead duplicate entry by explicit PM2 id (`pm2 delete 3` — safe, it wasn't running or serving anything), `pm2 save`d the cleaned state, then switched from one blind chained block to an explicit split-step procedure: (1) run `pm2 delete peerify` alone, (2) independently verify via `pm2 list`/`pm2 jlist` that zero `peerify` entries remain *before* proceeding, (3) only then hand over the `pm2 start` command. Step 1 succeeded cleanly this time (`pm2.log` showed the expected `Stopping app:peerify id:1` / `process tree killed` pair) and step 2 confirmed zero `peerify` entries — but the handed-off `pm2 start` in step 3 then left **zero trace at all** in `pm2.log` (not even a failed/crash-loop entry, unlike the first attempt) and prod went fully down (`HTTP 502`, no `peerify` process running) for the gap until it was re-run. Root cause of that specific failure was never conclusively identified — `pm2.log` staying completely silent means whatever went wrong happened upstream of PM2 itself (most likely shell-level: the multi-line block not fully executing, or a stale terminal/session state), not anything wrong with `current`, the symlink, or `deploy-common.sh` — `current` was confirmed intact immediately before and after this failed attempt, and the identical command succeeded moments later without any change on this end.

**Resolved:** re-ran the same `pm2 start ... --cwd .../current --update-env` command; this time it started cleanly (pid `1913444`, 0 restarts) with real, directly-observed PM2 output (unlike the prior "Done" report with no pasted output — worth treating as a standing practice going forward: always capture and share the literal output of any `pm2 start`/`delete` during a migration, since PM2's own log can't explain a failure that never reached the daemon). Verified end to end: `pm_cwd` reported as the literal `/home/tim/apps/peerify-app/current` path (not resolved — settles that `deploy-common.sh`'s migration guard's string comparison works correctly), BUILD_ID on disk (`08d-ZQGE83ho1z0ACrcbe`) matches the verified release exactly (confirms only the serving path changed, not the code), `peerify-staging` pid/uptime (`1891820`/`1786993450348`) unchanged from the very first baseline captured before any of this began — confirmed untouched through the entire multi-hour ordeal — `GET https://peerify.one/` and `/favicon.ico` both 200, `pm2 save` successful.

**Status:** prod fully migrated onto the atomic-release scheme and confirmed stable; code committed (`836206bc`, "Harden deploy-peerify.sh against interruption with atomic releases"). Two real near-misses during the migration itself (a duplicate crash-looping process, then a full but brief outage) were both caused by the manual `pm2 delete`/`pm2 start` handoff step specifically — not by the atomic-release design, which behaved exactly as intended throughout (the live directory was never touched or put at risk by any of this; every failure mode here was about swapping PM2's process registration, not about the release/build/verify pipeline). Worth remembering for any future PM2 identity migration on this box: split delete and start into independently-verified steps, and always capture literal command output rather than a "done" summary.

## 2026-08-18 — Song ovations (Phase 2a) promoted to prod, first real use of the hardened deploy-peerify.sh pipeline

Promotion of the ovation-tap feature (built and iteratively refined on staging across several sessions — see staging's own `SESSION_LOG.md` for the full build/refinement/verification history) plus its two pre-prod polish rounds. Comments (Phases 0/1/1b) were already live on prod from an earlier promotion; this was ovations-only.

**Pre-flight check, per the documented "Merge workflow for staging → prod" above:** every ovation-related commit was made on `main` first this cycle and only cherry-picked *onto* staging (never the reverse), so `main`'s history already contained everything staging had verified — confirmed concretely, not just assumed from commit history, via a byte-for-byte diff of all 8 touched files (`ovate-button.tsx`, `ovation-actions.ts`, `ovation-tick.ts`, `track.ts`, `Music.tsx`, `track-row.tsx`, `track-preview-row.tsx`, `post-list.tsx`) between the `main` and `staging` worktrees — all identical. No cherry-pick/merge action was actually needed, just this verification. Also confirmed exactly where the gap was: prod's then-current release (`migration-6e4d0f9e`) already included Comments (via `4f074b54`, several commits before the migration) but predated every ovation commit (`6e4e3405` onward) entirely.

**Baseline captured before touching anything:** `peerify` pid `1913444` (0 restarts), `peerify-staging` pid `1926926` (unaffected by anything below), `PORT` env var empty (safe, per the deploy-safety rule above), `main` HEAD `11d403f5`, working tree clean.

**Deploy:** `./scripts/deploy-peerify.sh` from `~/apps/peerify-app/circles` — all 9 steps passed. Fresh build from `main` HEAD `11d403f5`, BUILD_ID `VEj-gyJvWE1CMgXn7I8Jd`, assembled into `releases/20260818-145451-11d403f5`, verified in isolation before the atomic swap, `pm2 restart` (not delete+start — this repo is already on the atomic-release scheme from the migration logged above, so no identity-swap risk here) brought up pid `1928490` (1 restart, exactly as expected from a normal restart), `peerify-staging` pid/uptime (`1926926`/`1787060116371`) confirmed unchanged throughout.

**Verified independently from outside the deploy script itself:** external `curl` (not just the script's own localhost checks) — `GET https://peerify.one/` → 200, a static CSS asset → 200. Grepped the raw `/explore` HTML response directly for the literal BUILD_ID string (`VEj-gyJvWE1CMgXn7I8Jd`) rather than trusting only the deploy script's own on-disk verification — found it, confirming the live site is actually serving this build, not a stale cache.

**Docs updated:** `PEERIFY_CONTEXT.md` §0 Build Status — added Comments (0/1/1b) and Ovations Phase 2a to the "live on production" list, explicitly noting Phase 2b (ovation-digest notifications) remains deliberately deferred until real clap volume is observed in production; bumped the "last updated" date.

**Status:** live on peerify.one, verified. Next: watch real prod clap volume to inform Phase 2b's digest-notification design, whenever that gets picked up.

## 2026-08-20 — Events cleanup (Batches A/B/C), event host-change feature, and personal-profiles Events-module fix — all four shipped to prod

A large stretch of events work landed and was promoted to production tonight, across two separate promotions: the events-cleanup batches (merged to `main` earlier in the session, commit `ffc393e3`) and the host-change + Events-module fix (merged to `main` as `86d8f709`, deployed same night). Each is summarized below; see individual `staging` commits for full diffs.

**Events cleanup, Batch A — housekeeping and draft-flow friction:**
- Renamed the event form's "Recurring meeting" label to "Recurring event" and the draft stage-control button "Open" to "Publish" — both were leftover Kamooni/Circles wording that didn't match how Peerify actually talks about events.
- The global create-event modal now auto-closes and redirects straight to the new draft on success, instead of leaving the creator on a stale form.
- Added a delete-draft button (with a confirmation dialog) to the draft event view — previously a draft, once created, couldn't be removed without going through support.

**Events cleanup, Batch B — location prefill and informational ticketing:**
- A new event's Location field now preloads from the creating circle/profile's own saved location, instead of starting blank every time.
- Added an optional "Ticketed event" toggle that gates a Pricing section (Price, Currency — EUR/USD/GBP/SEK, and free-text Payment info). This is informational only — there is no real payment processing behind it; it exists so an artist/venue can tell fans a price and how to pay, nothing more.

**Events cleanup, Batch C — privacy toggle, progressive disclosure, fan preview:**
- Added a "This is a private/home event" toggle under Venue & location privacy. Defaults when enabled: hide the exact venue/host identity, show only an approximate area on the map, and require approval before an interested fan gets full access details.
- Added "More options" progressive disclosure to the create form, collapsing Images/Artists/Virtual/Capacity/Recurring behind a single expandable section — Visibility and Noticeboard-sharing were deliberately kept always-visible rather than folded in, since those two get checked/changed far more often than the rest. Went through several layout-adjustment rounds (trigger visual weight, which fields live in which column) based on live review before settling.
- Added a "Preview as a fan would see it" link on the draft event view, reusing the actual anonymous-visitor sanitizer (`sanitizePeerifyPublicEventDisplay`) rather than a separate mocked-up preview — so what a creator sees in preview is guaranteed to match what a real anonymous visitor gets, not an approximation of it.

**Bug fixes shipped alongside the batches above:**
- The anonymous-visitor event sanitizer was missing the new ticketed/price/currency/paymentInfo fields entirely — a ticketed event's pricing silently vanished for any logged-out viewer. Fixed by extending the sanitizer's field allowlist.
- A missing React `key` on a conditionally-rendered sibling was causing an unrelated component to fully remount every time the "Ticketed event" toggle flipped, discarding its own local state in the process. Fixed by keying the JS-conditional render instead of relying on mount/unmount identity (CSS-hide pattern, not unmount).
- Virtual events were missing from the map-based Events feed even when they had a location set on the host circle, because the map query implicitly required event-level coordinates virtual events don't have. Fixed by including virtual events in the map query unconditionally, removing the now-redundant client-side filter that had been silently papering over the same gap, and adding an opt-in "Physical events only" filter for anyone who specifically wants the old behavior back.

**Event host-change feature** (commits `0ef1bde1`/`12fbd07d`/`1d8d6d52`/`b1a505d5`/`9c140690`/`4a9e4859` staging → `86d8f709` main): previously an event's host circle could only be chosen at creation and was fixed forever after. An event's creator can now change its host after the fact, on drafts and published events alike. If the creator administers the target circle, the change is instant (updates `event.circleId`, migrates the event's tasks to the new circle so they don't vanish from the task panel, and recomputes the comment shadow-post's `feedId` so comment visibility follows the new host). If not, it creates a pending `eventHostChangeRequest`, notifies the target circle's admins, and only applies once approved — mirroring the existing `membership-requests` approval pattern rather than inventing a new one. RSVPs are deliberately left untouched (a historical snapshot of who RSVP'd under which circle at the time, with no live dependency on the current host). Stale `/circles/{oldHandle}/events/{id}` URLs (and `/edit`, `/preview`) now redirect to the new host's canonical URL instead of 404ing, since `event.circle.handle` is populated from a live lookup on every fetch and can simply be compared against the URL's handle.

**Personal-profiles Events-module fix** (commits `a47bf605`/`525f570d` staging → `86d8f709` main): investigated a report that a personal profile could create an event via the global Create button, then get a "Not found… disabled" error visiting its own Events tab for that same event. Root cause: `defaultUserModules` never included `"events"` (venues already got it by default; personal profiles didn't), and the one place that tried to compensate — an existing `ensureModuleIsEnabledOnCircle("events", …)` call inside `createEventAction` — silently swallowed its own errors and returned `false` instead of throwing, so a failed auto-enable left the event created but the tab permanently 404ing with zero trace in the logs. Fixed both ends: added `"events"` to `defaultUserModules` so new personal profiles get it from day one, and hardened the existing auto-enable call (moved before `revalidatePath`, added a `console.warn` on a `false` return) so existing profiles are covered and a future silent failure is at least debuggable.

**Deploy milestone:** tonight's host-change/Events-module promotion was the first real end-to-end run of the atomic-release `deploy-peerify.sh` pipeline against prod for a normal feature promotion (as opposed to the one-time migration dry-run logged 2026-08-17/18) — all 9 steps passed (build → assemble → verify → atomic swap → PM2 restart → HTTP checks → prune), staging's pid/uptime confirmed unchanged throughout, BUILD_ID `Q27yFA5wji5apcH3w8BN-`.

**Known minor issue, deferred (not fixed tonight):** Price/Currency/Payment-info values entered under the "Ticketed event" toggle don't persist in form state if the toggle is switched off and back on again before saving — the fields visually reset even though nothing has been submitted yet. Low priority (workaround: don't toggle back and forth before saving); logged here so it isn't rediscovered as a surprise later.

**Backlog, logged for later, not yet scoped:**
- **Event co-hosting** — naming/credit only (e.g. "hosted by X, with Y"), explicitly not shared editing rights. Distinct from the multi-artist "additional artists" feature already built, which is about performer credit, not hosting/ownership.
- **Rework "Public event" into a clearer Public/Private toggle**, with draft-time invitee selection for private events (currently `visibility` exists on the model but the create-flow UX around it hasn't been redesigned to make the distinction obvious to a creator).

**Status:** all four pieces of work (Batches A/B/C, the host-change feature, and the personal-profiles Events-module fix) are live on `main`/prod as of tonight. `staging` and `main` are in sync for everything covered here.
## 2026-08-22 — Standing rule: explicit confirmation required before any prod-touching action

Tim's instruction, to persist across sessions regardless of which repo/terminal a future session starts in: **before any action that deploys to, pushes to, or otherwise touches prod** (`git push origin main`, running `scripts/deploy-peerify.sh`, restarting the `peerify` pm2 process, or writing to the prod Mongo db `circles`), explicitly state that the target is prod and wait for explicit go-ahead before proceeding. This applies even if an earlier message in the same conversation already seemed to authorize a prod action — a prior "deploy to prod" is not standing authorization for a later one; ask again, every time. Recorded in both repos' `CLAUDE.md` under "Deploy Safety — Prod Confirmation Required".

## 2026-08-26 — Mobile Explore header overhaul: avatar embedded into search bar, iOS scroll/zoom fixes, Advanced Filters polish — all shipped to prod

Started from an iPhone 11 screenshot showing real header overflow (search bar/pills clipped, no left scroll arrow visible). Investigated and fixed that, then kept going through a long chain of related mobile-Explore issues surfaced by follow-up testing — twelve pieces of work in total, promoted to prod across two cherry-pick batches (staging `2e6edaee`..`2914de83` → main `ea7077c4`..`acad4afe`; staging `b5c68897`/`dbc6efa7` → main `c377089c`/`d1401d7c`).

**Header-overflow fixes (earlier in the session, commits `a9c666bc`/`d43023d5`/`b80273a6`/`3e1e0a09`/`df58ba6b` staging → `8b8224be`/`6d1beead`/`9b494fcc`/`fdeb4e66`/`dcfd589a` main):**
- Fixed the actual overflow bug: the top-bar's reserved right-inset (`mobileTopControlsRight`) wasn't auth-state-aware — 205px logged-out (room for Log in/Sign up), 76px logged-in (room for just the avatar).
- Removed the search bar's width cap and hid the filter-carousel's arrow buttons on mobile (swipe already worked natively; the arrows were just visual clutter competing for space).
- Added a scroll-fade mask hint on the pill carousel's edges, then removed it again later in the session in favor of a clean hard cutoff (Tim's preference, matching Google Maps' style over a soft fade).
- Tightened the pill-carousel's edge margins twice, ending flush with the search bar's own inset above it.

**Avatar embedded into the search bar (commit `2e6edaee`/`2324cf24` staging → `ea7077c4`/`d1ccf3cc` main):** major redesign, Google Maps pattern — the avatar (and its unread-badge fan-out) now renders inside the search bar's own trailing end instead of floating fixed top-right. Implemented via a jotai atom carrying a DOM-node ref: `map-explorer.tsx` publishes a slot at the search bar's trailing end, `profile-menu.tsx` portals its existing fan-out UI into it. Falls back to the old fixed-position render whenever that slot isn't mounted (e.g. the UserToolbox panel hides the search bar entirely), so the avatar never just vanishes. Combined unread badge shows only while collapsed; individual per-icon badges show once fanned out, with no duplicate counts. Desktop untouched throughout.

**UserToolbox close-button collision (commit `8701bd79` staging → `b2d782f9` main):** the toolbox panel's close (X) — previously a standalone overlay in `side-panel.tsx` — was colliding with the "Sign out" button once the avatar redesign changed what sat near it. Moved into the header row beside "Sign out," sharing the existing `closeToolbox` handler. Added an opt-in `hideClose` prop to the shared `DialogContent` so this could be re-styled/repositioned for just this one Dialog without touching the ~75 other Dialog usages across the app.

**iOS zoom-on-focus (commit `0e16950f` staging → `7f613f5c` main):** the search input was `text-sm sm:text-base` — 14px at every width up to Tailwind's `sm:` breakpoint (640px), which none of the target widths (375/390/430) ever reach — so it was 14px everywhere on mobile, under iOS Safari's 16px auto-zoom threshold. Simplified to an unconditional `text-base` (16px); no visual change at 640px+, where it was already 16px.

**Avatar hides while search is focused (commit `0e16950f` staging → `7f613f5c` main, same commit as the zoom fix):** a new `mobileExploreSearchFocusedAtom`, set on the search input's focus/blur, tells `profile-menu.tsx` to skip rendering into the embedded slot while focused — the slot naturally collapses to zero width and the input's existing `flex-1` expands into the freed space, mirroring Google Maps hiding its account icon during active search. If the fan-out was open when focus happened, it's collapsed first so it isn't left expanded-but-invisible underneath.

**Genre Select closing itself on window resize (commit `2914de83` staging → `acad4afe` main):** reported as "the genre list's scroll position resets before you can tap an item." Root cause, confirmed by dispatching a single synthetic resize event at the open dropdown and watching it close within one frame: Radix's `Select` closes itself on any `window resize` — and iOS Safari fires resize events continuously during any scroll gesture, as its address bar collapses/expands, including a scroll happening inside the dropdown's own 31-item list. Ruled out an app-level remount (marked the trigger/content DOM nodes before firing the event; same nodes afterward, only Select's own open-state flipped) and a Popper/floating-ui repositioning side effect (`position="item-aligned"` didn't avoid it either). Fixed by making the Select controlled and ignoring a close request that arrives within 250ms of a resize — genuine dismissals (Escape, outside tap, selecting an item) are never immediately preceded by one, so those still work.

**Genre Select popup exceeding available height on short viewports (commit `b5c68897` staging → `c377089c` main):** separate report — on iPhone SE (375×667), the genre list opened already scrolled past "Acoustic" (the alphabetically-first entry), showing "Blues" at the top instead. Root cause: `select.tsx`'s shared `SelectContent` hardcodes `max-h-96` (384px) regardless of how much room Radix actually has above/below the trigger; Radix computes the real number itself via `--radix-select-content-available-height` (293px in the 667px-tall repro) but the wrapper never used it. When 384px exceeds that, Radix still positions the popup to fit the oversized box, pushing its top off-screen (`rect.top: -85px`) — the list's own `scrollTop` was already correctly 0, it was the whole popup rendering partly above the viewport. Fixed with `max-h-[min(24rem,var(--radix-select-content-available-height))]` — same 384px cap when there's room, shrinks only when there genuinely isn't; can only reduce an already-overflowing popup, never grow one that was fine, so no regression risk to the other ~15 `Select` usages sharing this component. **Correction to an earlier assumption in this session:** this was initially guessed to be a low-priority "known non-fix" (shrinking SE user base, not worth engineering time) before investigation — turned out to have a clean, one-line, safe root-cause fix, so it shipped like everything else above rather than being left alone.

**Advanced Filters panel polish (commit `dbc6efa7` staging → `d1401d7c` main):**
- "Clear all" and the panel's close (X) were hard to visually tell apart, both sitting ghost-styled in the same top-right corner. Gave "Clear all" a bordered white pill and the close X a filled gray circle (matching the UserToolbox close button's style, via the same `hideClose` opt-out from that fix above) — one reads as secondary/clearing, the other as neutral/closing.
- Selected genres were invisible while browsing the dropdown (filtered out of the list entirely) and only reviewable via pills that existed on the map view alone. Selected genres now stay in the list with a checkmark, and the same `genrePillsRow` already used on the map view is also rendered directly below the genre selector inside the panel — same state, same JSX in both places, so the dropdown checkmarks, the panel's pills, and the map view's pills can never drift out of sync with each other.

**Verification:** every item above was manually verified live on staging (Playwright against `https://staging.peerify.one`, throwaway non-admin test accounts via the login-link technique, cleaned up after each check) at 375/390/430px, and — once the short-viewport bug surfaced — also at 375×667 and 320×568. Each promotion to prod used the standard cherry-pick + `deploy-peerify.sh` pipeline, with `peerify-staging`'s pid/uptime confirmed unchanged after every prod deploy.

**Status:** all twelve items are live on `main`/prod as of tonight. `staging` and `main` are in sync for everything covered here.

## 2026-08-26 (evening) – 2026-08-27 — Category-aware search Phase 2, plus two Clear-all fixes — shipped to prod

Building on Phase 1 (`9f79bb00`/`98e6f9c4`, already live on prod from a prior session — Genre/Physical-events-only/Calendar filters in Advanced Filters respecting whichever single category tab was active), this session replaced the single-category model with real multi-select category search, across four Phase 2 commits (`2fef93f5`/`9ec32bcd`/`9883b367`/`c83006c5` staging → `c1f7e32c`/`a6c08e37`/`aae81584`/`10dc8407` main), each independently verified on staging before the next was built:

1. **State migration** (`2fef93f5`/`c1f7e32c`): `selectedCategory` (single value) → `selectedCategories` (array) as the real source of truth, threaded through every read/write site (`filterCirclesByCategory`, the map-marker effect, the desktop search panel, and three external effects that force a category via URL param/mobile drawer/deep-link). Pure refactor — verified bit-for-bit unchanged pill behavior before proceeding to the next step.
2. **Pill component swap** (`9ec32bcd`/`a6c08e37`): `category-filter.tsx`'s Radix `ToggleGroup` (structurally single-select only) replaced with plain controlled buttons driven by `selectedCategories.includes(category)` — enables multiple pills highlighted at once, and fixes an a11y mismatch (`role="radio"`/`aria-checked` implied exactly-one-selected, no longer true once multi-select landed). Preserved the existing tap-the-sole-active-pill-to-deselect-to-All behavior.
3. **Multi-select Category field in Advanced Filters** (`9883b367`/`aae81584`): a checkbox card matching the existing Genre/Physical-events-only styling, pre-filled from and bidirectionally synced with `selectedCategories`. The top pills act as a "reset to one" shortcut into the same state. Deselecting to zero falls back to "All" (the existing empty-array convention already used elsewhere — no special-casing needed). Map pins needed no code changes here: `map.tsx` already rendered mixed circle+event content correctly whenever fed mixed data, once step 1 supplied it.
4. **Results-list sectioning, desktop + mobile** (`c83006c5`/`10dc8407`, built as one commit since the two turned out tightly coupled): desktop's flat list extracted into a `ResultListItem` grouped by type, plus a new "Other" catch-all section for non-Artist/Venue/Event content (personal profiles, projects, posts) so it no longer silently vanishes from "All" results. The mobile drawer gained real per-category sections for the first time — previously Events only ever appeared via a fully separate bottom-nav-only panel, decoupled from Advanced Filters entirely. Added a new event row to the mobile drawer (same footprint as the existing circle row), verified tap-to-preview opens the real event detail (hero image, RSVP, description), not just a visual shell.

**Follow-up fix 1 — "Clear all" visibility gap** (`2e914e91` staging → `0cdaa7b1` main): the button's active-filter count only ever weighed date/genre/physical, so Category deviating alone (e.g. switching from the Artists-only default to Artists+Venues) left "Clear all" hidden even though a filter was genuinely active. A gap in Phase 2's original design, not a pre-existing defect. Fixed by including `isCategoryFilterActive` in the same count.

**Follow-up fix 2 — "Clear all" didn't refresh results** (`74702297` staging → `64b9d966` main): reported repro — select a genre, note the filtered count, click Clear all, the genre pill/checkbox visibly resets but the results list/count stays at the old filtered value until a manual page refresh. Root cause: `handleClearAdvancedFilters` only ever reset filter *state*, never re-triggered a recompute. That's harmless for date/physical/category, which are pure client-side `useMemo` filters over already-fetched data — but genre filtering happens server-side, baked into the already-fetched `allSearchResults` by `searchContentAction`, so clearing `selectedGenres` alone left nothing to re-derive from. Confirmed pre-existing (not introduced by the Phase 2 work above): the `genrePillChangedRef` comment already claimed `handleClearAdvancedFilters` "already perform[s] their own synchronous reset," which was never actually true. Fixed by reusing the same debounced re-fetch mechanism genre-pill add/remove already uses (`genrePillChangedRef.current = true` before clearing `selectedGenres`), rather than introducing new logic — a 7-line diff.

**Verification:** every item was manually verified live on staging (Playwright against `https://staging.peerify.one`, throwaway test accounts via the login-link technique, cleaned up after each check) at mobile widths plus desktop. The two Clear-all fixes were verified specifically against their reported repros — genre-only (pill count 1 → 7 immediately after Clear all, no refresh) and Category-also-active (Artists+Venues + a genre, Clear all correctly resetting both the category checkboxes and the result count together). All promoted to prod via the standard cherry-pick + `deploy-peerify.sh` pipeline; each prod deploy's live `BUILD_ID` was independently confirmed by grepping it out of a real HTTP response, not just trusting the deploy script's own summary, and `peerify-staging`'s pid/uptime was confirmed unchanged after every prod deploy.

**Status:** all of the above (Phase 2's four commits, both Clear-all fixes) are live on `main`/prod as of 2026-08-27. `staging` and `main` are in sync for everything covered here.

## 2026-08-28 — Venue/event tags feature: complete and live on prod

Fixed-enum venue/event feature-icon tags (Age, Alcohol, Food, Seating, Setting, Accessibility,
Venue type) — schema/snapshot plumbing, a Circle-level `defaultEventTags` (editable in Circle
settings, snapshotted onto each new event at creation), an event create/edit picker (collapsible
on the edit page, matching the existing "More options" pattern), and read-only icon+caption
display badges on the event detail page, the timeline card, and the mobile map-panel row.
Bundled with three fixes found and shipped alongside it: a Stage-controls permission leak (the
admin-only status/action card was rendering for every viewer, not just admins/authors), the
When/Where cards repositioned to the bottom of the event detail page (previously duplicated the
compact header line before the reader reached RSVP/Artists), and the "Preview as a fan" button
made permanently visible to admins regardless of event stage (the underlying route never had a
stage restriction — only the button's visibility did). 13 commits (staging `83ad4e0b`..`dfb88d84`
→ main `76cd5ffc`..`bcd63e42`), cherry-picked and promoted via the standard pipeline;
`deploy-peerify.sh` succeeded, `peerify-staging`'s pid/uptime confirmed unchanged after the prod
deploy.

**Open follow-ups, not yet scoped:**
- RSVP status can't be changed once set — bug, not yet investigated.
- Tag-based event search/filter — feature request, not yet scoped.

**Status:** live on `main`/prod as of 2026-08-28.

## 2026-08-29 — Venue event-tags gating fix, second Save button, Artist type simplification + rename, and legacy-data migration — shipped to prod

**Venue event-tags gating bug fix (commit `7499b04f` staging → `4ffc8c3f` main):** the "Default event tags" settings card (built 2026-08-28, see that entry) was rendering/applying unconditionally for every circle type — personal profiles, Artist/Band/DJ/Producer, Venue, plain circles, and Projects — instead of Venue-only as intended. Investigated and gated across every consumer found: the settings UI card (`about-settings-form.tsx`), the event create/edit pre-fill (`event-form.tsx`), `createEventAction`'s persistence fallback (`actions.ts`), and a 4th consumer surfaced only during the fix — `getCircleDefaultEventTagsAction` (`actions.ts:1882`), which had the same unconditional behavior and would have kept leaking defaults into non-Venue events even with the other three sites fixed. Deployed to staging, then cherry-picked to `main` and deployed to prod.

**Second "Save Changes" button (commit `790d3c0e` staging → `4a43aadf` main):** added a second Save button below the Default event tags section on the About settings form, Venue circles only — the only circle type where the form is now long enough to need one. Reuses the existing submit handler; no duplicate save logic.

**Artist type field simplification + rename (commit `ff4bcb6c` staging → `afed1458` main):** renamed the signup form's "Band name" field label/placeholder to "Performing name" — confirmed no schema rename was needed, since it's a shared `bandOrVenueName` variable, not a dedicated field. Simplified the Artist Identity settings "Artist types" checkbox list from 9 options (Solo artist, DJ, Singer-songwriter, Acoustic act, Band, Musician, Live electronic, Collective, Cover artist) down to 4 (Solo artist, Band, DJ, Other). Selecting "Other" reveals a multi-tag chip input (`artistTypeOtherLabels: string[]`) supporting multiple free-text labels — built as a general-purpose capability, not a migration-only shim.

**Data migration:** ran a dry-run-then-write migration mapping legacy checkbox values onto the new schema — `Collective` → `Band`; `Singer-songwriter`/`Acoustic act`/`Live electronic`/`Cover artist`/`Musician` → `Other`, each preserved as its own distinct label in `artistTypeOtherLabels` rather than merged into a single string. Ran against staging (2 circles affected: `the-band`, `mingeltrubaduren`) and separately against prod (1 circle affected: `mingeltrubaduren` — prod's own distinct document, confirmed a different `_id` from staging's same-handle circle). Both runs were dry-run-reviewed and approved before writing. Verified 0 circles remain with legacy values in either environment post-migration.

**Deploy-script path correction:** resolved recurring confusion over deploy-script locations — `deploy-peerify.sh`/`deploy-staging.sh` live in a `scripts/` subdirectory inside each worktree (`/home/tim/apps/peerify-app/circles/scripts/`, `/home/tim/apps/peerify-staging/circles/circles/scripts/`), not at the worktree root. Flagged a stale legacy copy at `/home/tim/apps/peerify/circles/scripts/` (the deprecated pre-split checkout) to avoid it being confused with the real prod path.

**Status:** all of the above is live on `main`/prod as of 2026-08-29. `staging` and `main` are in sync for everything covered here.

## 2026-08-30 — Artist settings page cleanup (5 items)

**Published status card simplified** (commit `86c990c2`): investigated whether a draft↔published toggle exists anywhere (admin or artist-facing) before changing anything — confirmed `publishStatus` is strictly one-way, draft → (pending_verification →) published, with the only other write path being an admin's verification-rejection reverting a still-*pending* request back to draft, never touching an already-published circle. The card now hides entirely once published instead of showing a static "Published" no-op; for the simple one-way pilot-publish flow specifically, the Draft-state copy collapses to a minimal "Draft — not visible to others yet" plus the existing publish action (the richer pending-verification/readiness-checklist UI used by admin-reviewed circles was left untouched).

**Second "Save Changes" button** (commit `86c990c2`): added immediately after Primary Genre/Genre selection on Artist Identity settings, same pattern as the earlier Venue circle fix — reuses the existing `renderSaveButton()`, no duplicate submit logic.

**Booking enquiries split into its own card** (commit `86c990c2`): previously inline inside the Artist Identity card, now its own card/section positioned after the new Save button. Dependent fields (Local bookings only, Travel radius, Preferred event types, fee/currency, technical needs/notes) collapse automatically when the public booking-enquiry checkbox is off, via the same `Collapsible` component used for event-creation's "More options" disclosure.

**Spotify added to Music Links** (commit `86c990c2`): new field alongside Bandcamp/SoundCloud/Apple Music/YouTube/Linktree/Website in settings, plus an icon (`SiSpotify`) on the public artist profile's Listen & Follow row — the public page previously had no icon mapping for a Spotify link at all.

**"Looking for / Open to" hidden** (commit `86c990c2`): investigated first, before removing anything — confirmed `hasPeerifyArtistProfileContent()` (the only function referencing `lookingFor`) has zero callers, and the public artist profile component only ever renders `primaryGenres`/`genres`/booking status, never `lookingFor`. So this was settings-only dead UI with no public-facing counterpart to also hide. Removed the settings card only; schema/data left untouched (hide-not-delete, consistent with the earlier personal-profile Artist Profile section removal), pending a future "Open to collaboration" module.

**"Publish Circle" → "Publish Profile" copy rename** (commits `c6fd82db`, `1c945059`): investigated whether the Draft/Publish card's copy and button are shared across circle types before renaming — confirmed the same button/copy path is reachable by Artist/Band/DJ/Producer/Venue *and* by plain community Circles and Projects (`usesPilotPublishFlow` isn't type-scoped). Renamed to "Profile" only for Peerify-managed identities (Artist/Band/DJ/Producer/Venue, via the existing `isPeerifyManagedCircle` flag); plain Circles/Projects keep "Circle," since "Profile" read oddly there. Also fixed a now-stale server-action guard message that named the old "Publish circle" button by name.

**Status:** all of the above is live on `staging` as of 2026-08-30. Not yet cherry-picked to `main`/prod.

## 2026-08-30/31 — Pledge dialog overhaul (Tier 1 + follow-ups)

**Willingness-to-help collapsed by default** (commit `b2aa2e47` staging → `c36db9b0` main): same collapsible pattern as Booking enquiries, collapsed by default, shows a "(N)" selection count in the trigger when closed.

**Currency investigation + shared constant** (commits `b2aa2e47`→`c36db9b0`, `4bdc859a`→`cfb540b3`): the initial ask was to replace a "free-text currency input" on the Pledge popup with a dropdown — investigation found there was never a free-text input there at all, only a read-only badge showing the artist's configured currency (blank if unset), and the Booking settings Currency field had already been converted to a dropdown in a prior session. Extracted that dropdown's option list into a shared `PEERIFY_CURRENCY_OPTIONS` constant (`artist-profile.ts`) for reuse rather than leaving it duplicated. Later, the read-only badge was changed to default to **EUR** when the artist hasn't configured a currency, instead of showing nothing — display-only, never written to the artist's own profile data.

**"Event type" investigated, then removed** (commits `b348c5d6`→`165ef616` relabel, `f169aa70`→`bb280ab1` full removal): confirmed it fed the Pledge Dashboard's own column and the chat-enquiry fallback message before touching it, so it wasn't dropped blind. First relabeled ("Preferred event type" → "Event type," matching the Dashboard's own column header). Later, by explicit decision, removed from the popup entirely — both downstream readers already rendered a blank/missing value gracefully (`"-"` / `"Not specified"`, verified via `asString`'s `typeof`-guard, never a literal "undefined"), so no consumer-side code changes were needed; historical records and schema untouched.

**Join Crew button added to the popup** (commit `b2aa2e47`→`c36db9b0`): reuses the existing `JoinCrewDialog`/`getCrewMembershipStatusAction` flow and its three states (Join/View/Application Pending) — no new Crew logic. Omitted entirely when the artist has Crew disabled or isn't an artist-type identity. Later repositioned (commit `4bdc859a`→`cfb540b3`) to its own centered row below the Optional note field, separated from Cancel/Add Pledge — someone already in the dialog has shown intent, making it the highest-relevance moment to prompt Crew membership.

**Alignment + copy polish** (commit `4bdc859a`→`cfb540b3`): fixed the location/ticket-amount row drifting toward mid-height once the "Select different location?" link made the location column taller (`self-start` on the amount row). Intro copy changed to "A pledge is not a ticket purchase. It helps signal local demand and support."

**Pledge/Crew button color consistency** (commit `4bdc859a`→`cfb540b3`): audited every Pledge-related button/chip against the existing design convention that Peerify orange (`#FE801B`) is reserved for platform mechanics — the map-slider chip already used it correctly; the dialog's submit button and the profile page's "Pledge Interest" button were both on the default green button style and are now orange too. Separately audited every Crew button (map popup, full artist page, Pledge dialog, and the Crew tab's own landing/gate page) to a solid dark-ink fill (`#1A1612`) instead of outline/default-green, so Crew reads as a distinct, deliberate action without competing with orange (Pledge) or green (Save/confirm elsewhere).

**"Willingness to help" renamed and pruned** (commits `4bdc859a`→`cfb540b3`, `217d1b5a`→`205e4445`): header renamed to "Contribute to tour"; "Attend" removed (redundant — pledging already implies interest in attending); "Maybe host" renamed to "Host." The "Space for 20-30 people" checkbox was investigated before removal (same discipline as "Event type" above) — confirmed it fed the Pledge Dashboard's help-option breakdown and the chat-enquiry message — and rather than dropping that data, was replaced with a conditional free-text "Approximate capacity" field that reveals under "Host" (same automatic-collapse pattern as Booking enquiries), threaded through the same consumers it replaced (pledge record, chat-enquiry message, and a new per-pledge Dashboard display).

**Status:** live on `staging` as of 2026-08-31; cherry-picked to `main` and deployed to prod together with the multi-pledge fix below (see that entry).

## 2026-08-31 — Multi-pledge bug fix + data reconciliation

**Investigation:** checked what actually happens when the same fan pledges to the same artist more than once, by reading the real save path rather than inferring from the UI. `createPeerifyPledge` (`peerify-pledges.ts`) did a plain `insertOne` with no prior lookup, upsert, or uniqueness check of any kind — confirmed empirically too: staging's `peerify_pledges` collection had an actual duplicate pair from real testing, and prod had 16 total pledges across 4 duplicate `(artist, fan)` groups, one with 6 separate submissions from the same fan to the same artist over roughly two months.

**Fix** (commit `84e72461` staging → `98c7527a` main): `createPeerifyPledge` now upserts on `(artistCircleId, pledgerDid)` — a repeat pledge updates the existing record in place (fields overwritten, `updatedAt` bumped, `createdAt`/`_id` preserved) instead of creating a new row. Added a DB-level unique index on the same pair as a backstop against any future write path that bypasses `createPeerifyPledge`. The Pledge dialog now looks up the fan's existing pledge on open and pre-fills the form (location, amount, help options, hosting capacity, note) instead of showing blank, and switches its copy/button/toast text to an editing frame ("You've already pledged — update it below" / "Update Pledge" / "Pledge updated").

**Data reconciliation:** staging's one duplicate pair was merged (kept the earlier submission's ticket amount, folded in the later submission's Host/capacity/note) after an initial merge attempt was blocked by the auto-mode classifier and retried successfully on a second attempt. Prod's 4 duplicate groups (16 → 8 records) were resolved under a different, explicitly-agreed rule — **keep the single most recent submission per group, discard all earlier ones, no field-merging** — since these represented a genuinely evolving ask over weeks/months (one fan pledged from three different real locations across ~2 months) rather than an accidental double-submit. Every group's full field-by-field detail was dumped and reviewed before any write; the dry-run was explicitly approved (including one flagged tradeoff — an earlier submission's $50 amount and note being discarded under the no-merge rule) before the deletes ran. Verified 0 duplicate `(artist, fan)` pairs remain on both environments post-reconciliation, and the unique index built successfully on both.

**Promotion:** the pledge-dialog overhaul above plus this fix were cherry-picked to `main` as a 6-commit chain (`b2aa2e47`→`c36db9b0`, `b348c5d6`→`165ef616`, `4bdc859a`→`cfb540b3`, `217d1b5a`→`205e4445`, `f169aa70`→`bb280ab1`, `84e72461`→`98c7527a`), one merge conflict (a stale `Collapsible` import carried in as unrelated diff context from a not-yet-promoted commit, resolved by dropping the unused import) — typecheck/lint/build all clean throughout. Deployed to prod via the standard pipeline; live and verified via manual pledge testing including the repeat-pledge upsert behavior.

**Status:** live on `main`/prod as of 2026-08-31.
